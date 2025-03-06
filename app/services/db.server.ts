import sqlite3 from 'sqlite3';
import { open, Database } from "sqlite";
import { getProviderAccessToken, isAuthenticatedWithProvider, getProviderSession } from "./auth.server";
import { getLikedSongsSpotify, getAllUserPlaylistsSpotify, getPlaylistTracksSpotify } from "./selfApi.server";
import { getAllUserPlaylistsYouTube, getPlaylistVideosYouTube, convertYouTubeItemsToSongs, getLikedVideosYouTube } from "./youtubeApi.server";

import path from "path";
import { Song } from '~/types/customs';
import fs from 'fs/promises';
import { ToastMessage } from 'remix-toast';

// Define types for database records
interface SongRecord {
  id: number;
  title: string;
  artist_name: string; // JSON string
  album: string | null;
  album_image: string | null;
  playlist: string | null; // JSON string
  platform: string;
  url: string;
  downloaded: number; // SQLite stores booleans as 0/1
  local: number;
  platform_added_at: string;
  user: string;
}

// Initialize database connection
export async function getDb() {
    const db = await open({
        filename: path.join(process.cwd(), "app/db/songs.db"),
        driver: sqlite3.Database,
    });

    await db.exec(`
    CREATE TABLE IF NOT EXISTS user (
      user TEXT PRIMARY KEY,
      last_refresh TEXT
    );
    
    CREATE TABLE IF NOT EXISTS song (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      artist_name TEXT,
      album TEXT,
      album_image TEXT,
      playlist TEXT, -- Stores JSON array of playlists
      platform TEXT,
      url TEXT,
      downloaded BOOLEAN,
      local BOOLEAN DEFAULT 0,
      platform_added_at TEXT,
      user TEXT,
      FOREIGN KEY(user) REFERENCES user(user)
    );
  `);

    // Run migrations
    try {
        // Check if migrations table exists
        await db.exec(`
          CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            applied_at TEXT
          );
        `);

        // Check if playlist column migration has been applied
        const migrationExists = await db.get(
          "SELECT 1 FROM migrations WHERE name = 'modify_playlist_column'"
        );

        if (!migrationExists) {
          console.log("Running playlist column migration...");
          const migrationSql = await fs.readFile(
            "./app/db/migrations/modify_playlist_column.sql",
            "utf-8"
          );
          await db.exec(migrationSql);
          console.log("Playlist column migration completed.");
        }
    } catch (error) {
        console.error("Migration error:", error);
    }

    return db;
}

// Initialize tables if they don't exist
/* async function initDb() {
    const db = await getDb();

    await db.exec(`
    CREATE TABLE IF NOT EXISTS user (
      user TEXT PRIMARY KEY,
      last_refresh TEXT
    );
    
    CREATE TABLE IF NOT EXISTS song (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      artist_name TEXT,
      album TEXT,
      album_image TEXT,
      playlist TEXT,
      platform TEXT,
      url TEXT,
      downloaded BOOLEAN,
      local BOOLEAN DEFAULT 0,
      platform_added_at TEXT,
      user TEXT,
      FOREIGN KEY(user) REFERENCES user(user)
    );
  `);

    return db;
} */

export async function getSongs(userUUID: string) {
    const db = await getDb();
    try {
        const songs = await db.all(
            "SELECT * FROM song WHERE user = ?",
            userUUID
        );
        return songs;
    } catch (error) {
        return error;
    }
}

export async function updateSongDownloadStatus(songId: string, downloaded: boolean) {
    const db = await getDb();
    await db.run("UPDATE song SET downloaded = ? WHERE id = ?", [downloaded, songId]);
}

export async function updateSongLocalStatus(songId: string, local: boolean) {
    const db = await getDb();
    await db.run("UPDATE song SET local = ? WHERE id = ?", [local, songId]);
}

export async function getLatestRefresh(email: string) {
    const db = await getDb();



    try {
        const result = await db.get(
            "SELECT last_refresh FROM user WHERE user = ?",
            email
        );
        if (!result) {
            //new user
            return null;
        }
        return result.last_refresh;
    } catch (error) {
        throw new Error("error getLatestRefrresh")
    }
}

export async function getUserSongsFromDB(
  request: Request,
  options: {
    page?: number;
    itemsPerPage?: number;
    search?: string;
    platform?: string;
    playlist?: string;
    songStatus?:string;
    sortBy?: string;
    sortDirection?: 'asc' | 'desc';
  } = {}
) {
  const db = await getDb();
  
  // Try to get session from both providers
  const spotifySession = await getProviderSession(request, "spotify");
  const youtubeSession = await getProviderSession(request, "youtube");
  
  // Get emails from both sessions if available
  const spotifyEmail = spotifySession?.email || '';
  const youtubeEmail = youtubeSession?.email || '';
  
  // Check if at least one provider is authenticated
  if (!spotifyEmail && !youtubeEmail) {
    throw new Error("User not authenticated with any provider");
  }
  
  const {
    page = 1,
    itemsPerPage = 20,
    search = '',
    platform = '',
    playlist = '',
    songStatus = '',
    sortBy = 'platform_added_at',
    sortDirection = 'desc'
  } = options;

  const offset = (page - 1) * itemsPerPage;

  // Build the WHERE clause dynamically
  const whereConditions = [];
  const params: Array<string | number> = [];
  
  // Handle user condition - fetch songs from both accounts if available
  if (spotifyEmail && youtubeEmail) {
    whereConditions.push('(user = ? OR user = ?)');
    params.push(spotifyEmail, youtubeEmail);
  } else if (spotifyEmail) {
    whereConditions.push('user = ?');
    params.push(spotifyEmail);
  } else {
    whereConditions.push('user = ?');
    params.push(youtubeEmail);
  }

  if (search) {
    whereConditions.push('(title LIKE ? OR artist_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  if (platform) {
    whereConditions.push('platform = ?');
    params.push(platform);
  }

  if (playlist) {
    // Use JSON_EXTRACT to search within the JSON array
    whereConditions.push(`JSON_EXTRACT(playlist, '$') LIKE ?`);
    params.push(`%${playlist}%`);
  }
  
  if (songStatus) {
    if(songStatus === 'notDownloaded') {
      whereConditions.push('downloaded = 0');
    } else if (songStatus === 'localFiles') {
      whereConditions.push('local = 1');
    }
  }

  // Get total count for pagination
  const countResult = await db.get(
    `SELECT COUNT(*) as total FROM song WHERE ${whereConditions.join(' AND ')}`,
    params
  );
  
  const total = countResult?.total || 0;
  const totalPages = Math.ceil(total / itemsPerPage);

  // Get paginated results
  const songs = await db.all(
    `SELECT * FROM song 
     WHERE ${whereConditions.join(' AND ')}
     ORDER BY ${sortBy} ${sortDirection}
     LIMIT ? OFFSET ?`,
    [...params, itemsPerPage, offset]
  );

  // Parse the artist_name JSON string into an array
  const parsedSongs = songs.map(song => ({
    ...song,
    artist_name: JSON.parse(song.artist_name)
  }));

  return {
    songs: parsedSongs,
    currentPage: page,
    totalPages,
    total
  };
}

/**
 * Refresh Spotify library for a user
 * @param request Request object
 * @returns Object with songs and total count
 */
export async function refreshSpotifyLibrary(request: Request) {
  const db = await getDb();
  const isSpotifyAuthenticated = await isAuthenticatedWithProvider(request, "spotify");
  
  if (!isSpotifyAuthenticated) {
    return {
      success: false,
      message: "You need to authenticate with Spotify first. Please connect your Spotify account.",
      songs: [],
      total: 0
    };
  }
  
  const spotifySession = await getProviderSession(request, "spotify");
  console.log("Spotify session:", spotifySession);
  
  const userEmail = spotifySession?.email || '';
  console.log("User email from Spotify session:", userEmail);
  
  if (!userEmail) {
    return {
      success: false,
      message: "Could not determine user email from Spotify session. Please reconnect your Spotify account.",
      songs: [],
      total: 0
    };
  }
  
  const latestRefresh = await getLatestRefresh(userEmail);
  
  // Begin transaction
  await db.run('BEGIN TRANSACTION');
  
  try {
    const spotifyAccessToken = await getProviderAccessToken(request, "spotify");
    
    if (!spotifyAccessToken) {
      await db.run('ROLLBACK');
      return {
        success: false,
        message: "Failed to get Spotify access token. Please reconnect your Spotify account.",
        songs: [],
        total: 0
      };
    }
    
    // Verify token is valid by making a simple API call
    try {
      const testResponse = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${spotifyAccessToken}` }
      });
      
      if (!testResponse.ok) {
        if (testResponse.status === 401) {
          await db.run('ROLLBACK');
          return {
            success: false,
            message: "Your Spotify session has expired. Please reconnect your Spotify account.",
            songs: [],
            total: 0
          };
        }
      }
    } catch (error) {
      console.error("Error verifying Spotify token:", error);
    }
    
    // Process Spotify library
    const total = await processSpotifyLibrary(spotifyAccessToken, db, userEmail, latestRefresh);
    
    // Update the last refresh timestamp
    await db.run("UPDATE user SET last_refresh = ? WHERE user = ?", [
      new Date().toISOString(),
      userEmail,
    ]);
    
    // Commit transaction
    await db.run('COMMIT');
    
    // Get the updated songs from DB
    const userSongs = await getUserSongsFromDB(request, {
      page: 1,
      itemsPerPage: 10
    });
    
    return {
      success: true,
      message: `Successfully refreshed Spotify library. Added ${total} new tracks.`,
      songs: userSongs.songs,
      total: userSongs.total
    };
  } catch (error) {
    // Rollback transaction on error
    await db.run('ROLLBACK');
    
    console.error("Error refreshing Spotify library:", error);
    
    let errorMessage = "An error occurred while refreshing your Spotify library.";
    if (error instanceof Error) {
      if (error.message.includes("access token expired") || error.message.includes("re-authenticate")) {
        errorMessage = "Your Spotify session has expired. Please reconnect your Spotify account.";
      } else {
        errorMessage = `Error: ${error.message}`;
      }
    }
    
    return {
      success: false,
      message: errorMessage,
      songs: [],
      total: 0
    };
  }
}

/**
 * Refresh YouTube library for a user
 * @param request Request object
 * @returns Object with songs and total count
 */
export async function refreshYoutubeLibrary(request: Request) {
  const db = await getDb();
  const isYoutubeAuthenticated = await isAuthenticatedWithProvider(request, "youtube");
  
  if (!isYoutubeAuthenticated) {
    throw new Error("User not authenticated with YouTube");
  }
  
  const youtubeSession = await getProviderSession(request, "youtube");
  const userEmail = youtubeSession?.email || '';
  
  // Begin transaction
  await db.run('BEGIN TRANSACTION');
  
  try {
    const youtubeAccessToken = await getProviderAccessToken(request, "youtube");
    
    if (!youtubeAccessToken) {
      throw new Error("Failed to get YouTube access token");
    }
    
    console.log(`Refreshing YouTube library for user: ${userEmail}`);
    console.log(`Access token available: ${!!youtubeAccessToken}`);
    
    // Process YouTube library
    const total = await processYouTubeLibrary(youtubeAccessToken, db, userEmail);
    
    // Commit transaction
    await db.run('COMMIT');
    
    console.log(`Successfully processed ${total} YouTube items`);
    
    // Get the updated songs from DB
    const userSongs = await getUserSongsFromDB(request, {
      page: 1,
      itemsPerPage: 10
    });
    
    return {
      songs: userSongs.songs,
      total
    };
  } catch (error) {
    // Rollback transaction in case of error
    await db.run('ROLLBACK');
    console.error("Error refreshing YouTube library:", error);
    throw error;
  }
}

export async function populateSongsForUser(request: Request) {
  const db = await getDb();
  
  // Check if user is authenticated with either provider
  const isSpotifyAuthenticated = await isAuthenticatedWithProvider(request, "spotify");
  const isYoutubeAuthenticated = await isAuthenticatedWithProvider(request, "youtube");
  
  if (!isSpotifyAuthenticated && !isYoutubeAuthenticated) {
    throw new Error("User not authenticated with any provider");
  }
  
  // Get user email - we'll use the first available provider for this
  let userEmailSpotify = "";
  let userEmailYoutube = "";
  
  if (isSpotifyAuthenticated) {
    const spotifySession = await getProviderSession(request, "spotify");
    userEmailSpotify = spotifySession?.email || "";
  } 
  if (isYoutubeAuthenticated) {
    const youtubeSession = await getProviderSession(request, "youtube");
    userEmailYoutube = youtubeSession?.email || "";
  }
  
  // Store user in database if not exists
  if (userEmailSpotify) {
    await db.run("INSERT OR IGNORE INTO user (user, last_refresh) VALUES (?, ?)", [
      userEmailSpotify,
      new Date().toISOString(),
    ]);
  }
  
  const songs: Song[] = [];
  let toast: ToastMessage = { type: "success", message: "Songs refreshed successfully!" };
  let total = 0;
  
  try {
    // Begin transaction
    await db.run('BEGIN TRANSACTION');
    
    // Process Spotify if authenticated
    if (isSpotifyAuthenticated && userEmailSpotify) {
      const spotifyAccessToken = await getProviderAccessToken(request, "spotify");
      
      if (spotifyAccessToken) {
        const latestRefresh = await getLatestRefresh(userEmailSpotify);
        total += await processSpotifyLibrary(spotifyAccessToken, db, userEmailSpotify, latestRefresh);
      }
    }
    
    // Process YouTube if authenticated
    if (isYoutubeAuthenticated && userEmailYoutube) {
      const youtubeAccessToken = await getProviderAccessToken(request, "youtube");
      
      if (youtubeAccessToken) {
        try {
          total += await processYouTubeLibrary(youtubeAccessToken, db, userEmailYoutube);
        } catch (error) {
          console.error("Error processing YouTube library:", error);
          toast = { type: "error", message: "Error fetching YouTube videos. Spotify content was processed successfully." };
        }
      }
    }
    
    // Commit transaction
    await db.run('COMMIT');
    
    // Update the last refresh timestamp for Spotify user
    if (userEmailSpotify) {
      await db.run("UPDATE user SET last_refresh = ? WHERE user = ?", [
        new Date().toISOString(),
        userEmailSpotify,
      ]);
    }
    
    return { songs, toast, total };
  } catch (error) {
    // Rollback transaction in case of error
    await db.run('ROLLBACK');
    
    console.error("Error populating songs:", error);
    toast = { type: "error", message: "Error refreshing songs. Please try again." };
    return { songs, toast, total };
  }
}




export async function getSongById(id: string): Promise<Song | null> {
  const db = await getDb();
  const song = await db.get("SELECT * FROM song WHERE id = ?", id) as SongRecord | undefined;
  
  if (!song) return null;
  
  // Parse JSON fields
  return {
    ...song,
    artist_name: song.artist_name ? JSON.parse(song.artist_name) : null,
    playlist: song.playlist ? JSON.parse(song.playlist) : null,
    downloaded: Boolean(song.downloaded),
    local: Boolean(song.local),
    platform: song.platform as "Youtube" | "Spotify" | "Soundcloud"
  };
}

export async function handleSpotifyTracks(spotifyAccessToken: string, db: sqlite3.Database, userEmail: string, latestRefresh: string) {
  if (spotifyAccessToken) {
    // 1. Process liked songs
    const likedsongs = await getLikedSongsSpotify(0, 50, spotifyAccessToken);
    await db.run('BEGIN TRANSACTION');
    if (likedsongs) {
      const likedItems = likedsongs.items.filter(
        (t) => new Date(t.added_at) > new Date(latestRefresh)
      );
      
      if (likedItems && likedItems.length > 0) {
        for (const item of likedItems) {
          const artist_name = JSON.stringify(item.track.artists.map((t) => t.name));
          const playlistArray = JSON.stringify(["SpotifyLikedSongs"]);
          
          await db.run(
            `INSERT INTO song 
            (artist_name, downloaded, title, album, album_image, user, playlist, platform, url, platform_added_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              artist_name,
              0,
              item.track.name,
              item.track.album.name,
              item.track.album.images[0]?.url || '',
              userEmail,
              playlistArray,
              "Spotify",
              item.track.uri,
              new Date(item.added_at).toISOString()
            ]
          );
        }
      }
    }
    
    // 2. Process all user playlists
    const playlists = await getAllUserPlaylistsSpotify(spotifyAccessToken);
    
    for (const playlist of playlists) {
      console.log(`Processing Spotify playlist: ${playlist.name}`);
      
      const playlistTracks = await getPlaylistTracksSpotify(spotifyAccessToken, playlist.id);
      
      if (playlistTracks && playlistTracks.items.length > 0) {
        for (const item of playlistTracks.items) {
          // Check if this track was added after the latest refresh
          if (new Date(item.added_at) > new Date(latestRefresh)) {
            const artist_name = JSON.stringify(item.track.artists.map((t) => t.name));
            
            // Check if this track already exists in the database
            const existingSongResult = await db.get(
              `SELECT id, playlist FROM song WHERE url = ? AND user = ?`,
              [item.track.uri, userEmail]
            );
            
            // Use type checking to ensure we have a valid song record
            const existingSong = existingSongResult && 
                                typeof existingSongResult === 'object' && 
                                'id' in existingSongResult && 
                                'playlist' in existingSongResult ? 
                                existingSongResult : null;
            
            if (existingSong) {
              // Track exists, update the playlist array to include this playlist
              const existingPlaylists = JSON.parse(existingSong.playlist as string || '[]');
              if (!existingPlaylists.includes(playlist.name)) {
                existingPlaylists.push(playlist.name);
                await db.run(
                  `UPDATE song SET playlist = ? WHERE id = ?`,
                  [JSON.stringify(existingPlaylists), existingSong.id]
                );
              }
            } else {
              // Track doesn't exist, insert new record
              const playlistArray = JSON.stringify([playlist.name]);
              
              await db.run(
                `INSERT INTO song 
                (artist_name, downloaded, title, album, album_image, user, playlist, platform, url, platform_added_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"`,
                [
                  artist_name,
                  0,
                  item.track.name,
                  item.track.album.name,
                  item.track.album.images[0]?.url || '',
                  userEmail,
                  playlistArray,
                  "Spotify",
                  item.track.uri,
                  new Date(item.added_at).toISOString()
                ]
              );
            }
          }
        }
      }
    }
  }
}

export async function removeDuplicateTracks() {
  try {
    const db = await getDb();
    
    // Begin transaction
    await db.run('BEGIN TRANSACTION');
    
    // Find all duplicate tracks (same URL and user)
    const duplicates = await db.all(`
      SELECT url, user, COUNT(*) as count
      FROM song
      GROUP BY url, user
      HAVING COUNT(*) > 1
    `);
    
    console.log(`Found ${duplicates.length} duplicate track groups to merge`);
    
    let mergedCount = 0;
    
    // Process each set of duplicates
    for (const dup of duplicates) {
      // Get all instances of this duplicate
      const tracks = await db.all(
        `SELECT id, playlist, downloaded, local FROM song WHERE url = ? AND user = ?`,
        [dup.url, dup.user]
      );
      
      if (tracks.length <= 1) continue;
      
      // Keep the first track (preferably one that's downloaded)
      const downloadedTracks = tracks.filter(t => t.downloaded === 1);
      const localTracks = tracks.filter(t => t.local === 1);
      
      // Prioritize tracks that are downloaded and local
      const primaryTrack = 
        (localTracks.length > 0) ? localTracks[0] : 
        (downloadedTracks.length > 0) ? downloadedTracks[0] : 
        tracks[0];
      
      // Merge all playlists into the primary track
      const allPlaylists = new Set<string>();
      
      // Parse and collect all playlists
      for (const track of tracks) {
        try {
          const playlists = JSON.parse(track.playlist || '[]');
          playlists.forEach((p: string) => allPlaylists.add(p));
        } catch (e) {
          console.error(`Error parsing playlist JSON for track ${track.id}:`, e);
        }
      }
      
      // Update the primary track with all playlists
      await db.run(
        `UPDATE song SET playlist = ? WHERE id = ?`,
        [JSON.stringify([...allPlaylists]), primaryTrack.id]
      );
      
      // Delete all other duplicates
      const idsToDelete = tracks
        .filter(t => t.id !== primaryTrack.id)
        .map(t => t.id);
      
      if (idsToDelete.length > 0) {
        await db.run(
          `DELETE FROM song WHERE id IN (${idsToDelete.join(',')})`
        );
        mergedCount += idsToDelete.length;
      }
    }
    
    // Commit transaction
    await db.run('COMMIT');
    
    console.log(`Successfully merged ${mergedCount} duplicate tracks`);
    return { success: true, mergedCount };
  } catch (error) {
    // Rollback on error
    const db = await getDb();
    await db.run('ROLLBACK');
    console.error("Error removing duplicates:", error);
    throw error;
  }
}

/**
 * Get all unique platforms from the database for a specific user
 */
export async function getAllPlatforms(userEmail: string) {
  try {
    const db = await getDb();
    const platforms = await db.all(
      `SELECT DISTINCT platform FROM song WHERE user = ?`,
      [userEmail]
    );
    return platforms.map(p => p.platform).filter(Boolean);
  } catch (error) {
    console.error("Error fetching platforms:", error);
    return [];
  }
}

/**
 * Get all unique playlists from the database for a specific user
 * This function extracts playlists from the JSON array stored in the playlist column
 */
export async function getAllPlaylists(userEmail: string) {
  try {
    const db = await getDb();
    
    // Get all playlist JSON arrays for the user
    const playlistsData = await db.all(
      `SELECT playlist FROM song WHERE user = ? AND playlist IS NOT NULL`,
      [userEmail]
    );
    
    // Extract unique playlists from JSON arrays
    const allPlaylists = new Set<string>();
    
    for (const data of playlistsData) {
      try {
        const playlistArray = JSON.parse(data.playlist || '[]') as string[];
        playlistArray.forEach(playlist => allPlaylists.add(playlist));
      } catch (e) {
        console.error("Error parsing playlist JSON:", e);
      }
    }
    
    return [...allPlaylists].filter(Boolean).sort();
  } catch (error) {
    console.error("Error fetching playlists:", error);
    return [];
  }
}

/**
 * Get all filter options (platforms and playlists) for a specific user or users
 */
export async function getFilters(request: Request) {
  try {
    // Try to get session from both providers
    const spotifySession = await getProviderSession(request, "spotify");
    const youtubeSession = await getProviderSession(request, "youtube");
    
    // Get emails from both sessions if available
    const spotifyEmail = spotifySession?.email || '';
    const youtubeEmail = youtubeSession?.email || '';
    
    // Check if at least one provider is authenticated
    if (!spotifyEmail && !youtubeEmail) {
      throw new Error("User not authenticated with any provider");
    }
    
    let platforms: string[] = [];
    let playlists: string[] = [];
    
    // Get platforms and playlists for Spotify user
    if (spotifyEmail) {
      platforms = platforms.concat(await getAllPlatforms(spotifyEmail));
      playlists = playlists.concat(await getAllPlaylists(spotifyEmail));
    }
    
    // Get platforms and playlists for YouTube user
    if (youtubeEmail) {
      platforms = platforms.concat(await getAllPlatforms(youtubeEmail));
      playlists = playlists.concat(await getAllPlaylists(youtubeEmail));
    }
    
    // Remove duplicates
    const uniquePlatforms = [...new Set(platforms)];
    const uniquePlaylists = [...new Set(playlists)];
    
    return {
      platforms: uniquePlatforms,
      playlists: uniquePlaylists.sort()
    };
  } catch (error) {
    console.error("Error fetching filters:", error);
    return {
      platforms: [],
      playlists: []
    };
  }
}

/**
 * Process Spotify library for a user - fetches liked songs and playlists
 * @param accessToken Spotify access token
 * @param db Database connection
 * @param userEmail User's email
 * @param latestRefresh Latest refresh timestamp
 * @returns Number of tracks added
 */
export async function processSpotifyLibrary(accessToken: string, db: Database, userEmail: string, latestRefresh: string) {
  let total = 0;
  const errors: string[] = [];
  
  try {
    // 1. Process liked songs
    try {
      total += await processSpotifyLikedSongs(accessToken, db, userEmail, latestRefresh);
    } catch (e) {
      console.error("Error processing Spotify liked songs:", e);
      errors.push(`Liked songs error: ${e instanceof Error ? e.message : String(e)}`);
    }
    
    // 2. Process all user playlists
    try {
      total += await processSpotifyPlaylists(accessToken, db, userEmail, latestRefresh);
    } catch (e) {
      console.error("Error processing Spotify playlists:", e);
      errors.push(`Playlists error: ${e instanceof Error ? e.message : String(e)}`);
    }
    
    if (errors.length > 0) {
      if (total > 0) {
        // Some content was processed successfully
        console.warn(`Spotify library processed with errors: ${errors.join('; ')}`);
      } else {
        // Nothing was processed successfully
        throw new Error(`Failed to process Spotify content: ${errors.join('; ')}`);
      }
    }
    
    return total;
  } catch (error) {
    console.error("Error processing Spotify library:", error);
    throw error;
  }
}

/**
 * Process Spotify liked songs
 * @param accessToken Spotify access token
 * @param db Database connection
 * @param userEmail User's email
 * @param latestRefresh Latest refresh timestamp
 * @returns Number of tracks added
 */
export async function processSpotifyLikedSongs(accessToken: string, db: Database, userEmail: string, latestRefresh: string) {
  let total = 0;
  
  try {
    console.log(`Processing Spotify liked songs for user: ${userEmail}`);
    
    if (!userEmail) {
      console.error("User email is empty or null. Cannot process Spotify liked songs.");
      return 0;
    }
    
    const likedsongs = await getLikedSongsSpotify(0, 50, accessToken);
    
    if (likedsongs && likedsongs.items && Array.isArray(likedsongs.items)) {
      const likedItems = likedsongs.items.filter(
        (t) => new Date(t.added_at) > new Date(latestRefresh)
      );
      
      if (likedItems && likedItems.length > 0) {
        for (const item of likedItems) {
          const artist_name = JSON.stringify(item.track.artists.map((t) => t.name));
          const playlistArray = JSON.stringify(["SpotifyLikedSongs"]);
          
          await db.run(
            `INSERT INTO song 
            (artist_name, downloaded, title, album, album_image, user, playlist, platform, url, platform_added_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              artist_name,
              0,
              item.track.name,
              item.track.album.name,
              item.track.album.images[0]?.url || '',
              userEmail,
              playlistArray,
              "Spotify",
              item.track.uri,
              new Date(item.added_at).toISOString()
            ]
          );
          total++;
        }
      }
    } else {
      console.log("No liked songs found or invalid response format");
    }
    
    return total;
  } catch (error) {
    console.error("Error processing Spotify liked songs:", error);
    throw error;
  }
}

/**
 * Process Spotify playlists
 * @param accessToken Spotify access token
 * @param db Database connection
 * @param userEmail User's email
 * @param latestRefresh Latest refresh timestamp
 * @returns Number of tracks added
 */
export async function processSpotifyPlaylists(accessToken: string, db: Database, userEmail: string, latestRefresh: string) {
  let total = 0;
  
  try {
    console.log(`Processing Spotify playlists for user: ${userEmail}`);
    
    if (!userEmail) {
      console.error("User email is empty or null. Cannot process Spotify playlists.");
      return 0;
    }
    
    const playlists = await getAllUserPlaylistsSpotify(accessToken);
    
    for (const playlist of playlists) {
      console.log(`Processing Spotify playlist: ${playlist.name}`);
      
      const playlistTracks = await getPlaylistTracksSpotify(accessToken, playlist.id);
      
      if (playlistTracks && playlistTracks.items.length > 0) {
        for (const item of playlistTracks.items) {
          // Check if this track was added after the latest refresh
          if (new Date(item.added_at) > new Date(latestRefresh)) {
            const artist_name = JSON.stringify(item.track.artists.map((t) => t.name));
            
            // Check if this track already exists in the database
            const existingSongResult = await db.get(
              `SELECT id, playlist FROM song WHERE url = ? AND user = ?`,
              [item.track.uri, userEmail]
            );
            
            // Use type checking to ensure we have a valid song record
            const existingSong = existingSongResult && 
                                typeof existingSongResult === 'object' && 
                                'id' in existingSongResult && 
                                'playlist' in existingSongResult ? 
                                existingSongResult : null;
            
            if (existingSong) {
              // Track exists, update the playlist array to include this playlist
              const existingPlaylists = JSON.parse(existingSong.playlist as string || '[]');
              if (!existingPlaylists.includes(playlist.name)) {
                existingPlaylists.push(playlist.name);
                await db.run(
                  `UPDATE song SET playlist = ? WHERE id = ?`,
                  [JSON.stringify(existingPlaylists), existingSong.id]
                );
              }
            } else {
              // Track doesn't exist, insert new record
              const playlistArray = JSON.stringify([playlist.name]);
              
              await db.run(
                `INSERT INTO song 
                (artist_name, downloaded, title, album, album_image, user, playlist, platform, url, platform_added_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  artist_name,
                  0,
                  item.track.name,
                  item.track.album.name,
                  item.track.album.images[0]?.url || '',
                  userEmail,
                  playlistArray,
                  "Spotify",
                  item.track.uri,
                  new Date(item.added_at).toISOString()
                ]
              );
              total++;
            }
          }
        }
      }
    }
    
    return total;
  } catch (error) {
    console.error("Error processing Spotify playlists:", error);
    throw error;
  }
}

/**
 * Process YouTube library for a user - fetches playlists and liked videos
 * @param accessToken YouTube access token
 * @param db Database connection
 * @param userEmail User's email
 * @returns Number of tracks added
 */
export async function processYouTubeLibrary(accessToken: string, db: Database, userEmail: string) {
  let total = 0;
  const errors: string[] = [];
  
  try {
    // Process YouTube playlists only (skip liked videos)
    try {
      total += await processYouTubePlaylists(accessToken, db, userEmail);
    } catch (e) {
      console.error("Error processing YouTube playlists:", e);
      errors.push(`Playlists error: ${e instanceof Error ? e.message : String(e)}`);
    }
    
    // We're skipping liked videos processing as requested
    // No longer calling processYouTubeLikedVideos
    
    if (errors.length > 0) {
      if (total > 0) {
        // Some content was processed successfully
        console.warn(`YouTube library processed with errors: ${errors.join('; ')}`);
      } else {
        // Nothing was processed successfully
        throw new Error(`Failed to process YouTube content: ${errors.join('; ')}`);
      }
    }
    
    return total;
  } catch (error) {
    console.error("Error processing YouTube library:", error);
    throw error;
  }
}

/**
 * Process YouTube playlists
 * @param accessToken YouTube access token
 * @param db Database connection
 * @param userEmail User's email
 * @returns Number of tracks added
 */
export async function processYouTubePlaylists(accessToken: string, db: Database, userEmail: string) {
  let total = 0;
  
  try {
    // Get all YouTube playlists
    const playlists = await getAllUserPlaylistsYouTube(accessToken);
    
    // Process each playlist
    for (const playlist of playlists) {
      const playlistName = playlist.snippet.title;
      const playlistId = playlist.id;
      
      console.log(`Processing YouTube playlist: ${playlistName}`);
      
      // Get all videos in the playlist
      const videos = await getPlaylistVideosYouTube(accessToken, playlistId);
      
      // Convert videos to Song format with improved artist extraction
      const playlistSongs = convertYouTubeItemsToSongs(videos, playlistName);
      
      // Add songs to the database
      for (const song of playlistSongs) {
        // Check if song already exists by URL instead of title
        // This is more reliable since the title might change with our improved extraction
        const videoId = song.url.split('v=')[1];
        const existingSongResult = await db.get(
          "SELECT * FROM song WHERE url LIKE ? AND user = ?",
          [`%${videoId}%`, userEmail]
        );
        
        // Use type checking to ensure we have a valid song record
        const existingSong = existingSongResult && 
                            typeof existingSongResult === 'object' && 
                            'id' in existingSongResult && 
                            'playlist' in existingSongResult && 
                            'artist_name' in existingSongResult && 
                            'title' in existingSongResult ? 
                            existingSongResult : null;
        
        if (!existingSong) {
          await db.run(
            "INSERT INTO song (title, artist_name, album, album_image, playlist, platform, url, downloaded, local, platform_added_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              song.title,
              JSON.stringify(song.artist_name || []),
              song.album,
              song.album_image,
              JSON.stringify(song.playlist || []),
              song.platform,
              song.url,
              song.downloaded ? 1 : 0,
              song.local ? 1 : 0,
              song.platform_added_at,
              userEmail,
            ]
          );
          console.log(`Added new YouTube song: "${song.title}" by ${(song.artist_name || []).join(', ')}`);
          total++;
        } else {
          // Update existing song's playlist array if needed
          const existingPlaylists = JSON.parse(existingSong.playlist as string || "[]");
          if (!existingPlaylists.includes(playlistName)) {
            existingPlaylists.push(playlistName);
            await db.run(
              "UPDATE song SET playlist = ? WHERE id = ?",
              [JSON.stringify(existingPlaylists), existingSong.id]
            );
          }
          
          // Update the artist information if we have better data now
          const existingArtists = JSON.parse(existingSong.artist_name as string || "[]");
          const newArtists = song.artist_name || [];
          
          // Determine if we should update the artist information
          let shouldUpdateArtist = false;
          
          // Case 1: Existing artist is the channel name but we extracted a better artist
          if (existingArtists.length === 1 && 
              existingArtists[0] === playlist.snippet.channelTitle && 
              newArtists.length > 0 && 
              newArtists[0] !== playlist.snippet.channelTitle &&
              newArtists[0] !== "Unknown Artist") {
            shouldUpdateArtist = true;
          }
          
          // Case 2: Existing artist is "Unknown Artist" but we have a better artist now
          if (existingArtists.length === 1 && 
              existingArtists[0] === "Unknown Artist" && 
              newArtists.length > 0 && 
              newArtists[0] !== "Unknown Artist") {
            shouldUpdateArtist = true;
          }
          
          // Case 3: Existing artist looks like a username (matches our patterns)
          const userAccountPatterns = [
            /^user\d+$/i,
            /^\w+\d+$/i,
            /^[a-z0-9_]+$/i,
            /^populodaddy$/i,
            /^my\s*channel$/i,
            /^official\s*channel$/i,
          ];
          
          if (existingArtists.length === 1 && 
              userAccountPatterns.some(pattern => pattern.test(existingArtists[0])) &&
              newArtists.length > 0 && 
              newArtists[0] !== existingArtists[0] &&
              newArtists[0] !== "Unknown Artist") {
            shouldUpdateArtist = true;
          }
          
          if (shouldUpdateArtist) {
            // We have better artist information now
            await db.run(
              "UPDATE song SET artist_name = ?, title = ? WHERE id = ?",
              [JSON.stringify(newArtists), song.title, existingSong.id]
            );
            console.log(`Updated artist for "${song.title}" from "${existingArtists.join(', ')}" to "${newArtists.join(', ')}"`);
            
            // Also update the title if it's different and looks better
            if (song.title && existingSong.title && 
                song.title !== existingSong.title && 
                !song.title.includes("(") && 
                existingSong.title.includes("(")) {
              await db.run(
                "UPDATE song SET title = ? WHERE id = ?",
                [song.title, existingSong.id]
              );
              console.log(`Updated title from "${existingSong.title}" to "${song.title}"`);
            }
          }
        }
      }
    }
    
    return total;
  } catch (error) {
    console.error("Error processing YouTube playlists:", error);
    throw error;
  }
}

/**
 * Process YouTube liked videos
 * @param accessToken YouTube access token
 * @param db Database connection
 * @param userEmail User's email
 * @returns Number of tracks added
 */
export async function processYouTubeLikedVideos(accessToken: string, db: Database, userEmail: string) {
  let total = 0;
  
  try {
    const likedVideos = await getLikedVideosYouTube(accessToken);
    const likedSongs = convertYouTubeItemsToSongs(likedVideos, "Liked Videos");
    
    // Add liked songs to the database
    for (const song of likedSongs) {
      const existingSong = await db.get(
        "SELECT * FROM song WHERE title = ? AND platform = ? AND user = ?",
        [song.title, song.platform, userEmail]
      ) as { id: number; playlist: string } | undefined;
      
      if (!existingSong) {
        await db.run(
          "INSERT INTO song (title, artist_name, album, album_image, playlist, platform, url, downloaded, local, platform_added_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            song.title,
            JSON.stringify(song.artist_name),
            song.album,
            song.album_image,
            JSON.stringify(song.playlist),
            song.platform,
            song.url,
            song.downloaded ? 1 : 0,
            song.local ? 1 : 0,
            song.platform_added_at,
            userEmail,
          ]
        );
        total++;
      } else {
        // Update existing song's playlist array if needed
        const existingPlaylists = JSON.parse(existingSong.playlist || "[]");
        if (!existingPlaylists.includes("Liked Videos")) {
          existingPlaylists.push("Liked Videos");
          await db.run(
            "UPDATE song SET playlist = ? WHERE id = ?",
            [JSON.stringify(existingPlaylists), existingSong.id]
          );
        }
      }
    }
    
    return total;
  } catch (error) {
    console.error("Error processing YouTube liked videos:", error);
    throw error;
  }
}

export async function saveCustomUrlSong(
  url: string,
  title: string,
  artistName: string[],
  thumbnailUrl: string,
  platform: string,
  userId: string
): Promise<number> {
  const db = await getDb();
  
  try {
    // Check if the song already exists for this user
    const existingSong = await db.get(
      "SELECT id FROM song WHERE url = ? AND user = ?",
      [url, userId]
    );
    
    if (existingSong) {
      // Return the existing song ID
      return existingSong.id;
    }
    
    // Insert the new song
    const result = await db.run(
      `INSERT INTO song (
        title, 
        artist_name, 
        album_image, 
        album, 
        playlist, 
        platform, 
        url, 
        downloaded, 
        local, 
        platform_added_at,
        user
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        JSON.stringify(artistName),
        thumbnailUrl,
        "Custom URL",
        JSON.stringify(["Custom URL"]),
        platform,
        url,
        0, // not downloaded yet
        0, // not local yet
        new Date().toISOString(),
        userId
      ]
    );
    
    // Ensure we return a number even if lastID is undefined
    if (typeof result.lastID === 'undefined') {
      // Get the ID of the song we just inserted
      const insertedSong = await db.get(
        "SELECT id FROM song WHERE url = ? AND user = ?",
        [url, userId]
      );
      
      if (insertedSong && typeof insertedSong.id === 'number') {
        return insertedSong.id;
      }
      
      throw new Error("Failed to get ID of inserted song");
    }
    
    return result.lastID;
  } catch (error) {
    console.error("Error saving custom URL song:", error);
    throw error;
  }
}