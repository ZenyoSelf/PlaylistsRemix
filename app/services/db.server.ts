import sqlite3 from 'sqlite3';
import { open, Database } from "sqlite";
import { getProviderAccessToken, isAuthenticatedWithProvider, getProviderSession } from "./auth.server";
import { getLikedSongsSpotify, getAllUserPlaylistsSpotify, getPlaylistTracksSpotify } from "./selfApi.server";
import { getAllUserPlaylistsYouTube, getPlaylistVideosYouTube, convertYouTubeItemsToSongs, getLikedVideosYouTube } from "./youtubeApi.server";

import path from "path";
import { Song, Playlist, SongPlaylist } from '~/types/customs';
import { ToastMessage } from 'remix-toast';

// Define types for database records
interface SongRecord {
  id: number;
  title: string;
  artist_name: string; // JSON string
  album: string | null;
  album_image: string | null;
  platform: string;
  url: string;
  downloaded: number; // SQLite stores booleans as 0/1
  local: number;
  platform_added_at: string;
  user: string;
  playlist?: string | null; // For backward compatibility with existing code
}

// Database representation of Playlist
type PlaylistRecord = Omit<Playlist, 'added_at'>;

/**
 * Executes a database operation with retries for SQLITE_BUSY errors
 * @param operation Function that performs the database operation
 * @param maxRetries Maximum number of retry attempts
 * @param delay Delay between retries in milliseconds
 * @returns Result of the operation
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 5,
  delay: number = 100
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      // Only retry on SQLITE_BUSY errors
      if (error && 
          typeof error === 'object' && 
          'code' in error && 
          error.code === 'SQLITE_BUSY') {
        
        // Exponential backoff with jitter
        const backoffDelay = delay * Math.pow(1.5, attempt) * (0.9 + Math.random() * 0.2);
        console.log(`Database locked, retrying in ${Math.round(backoffDelay)}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        continue;
      }
      
      // For other errors, throw immediately
      throw error;
    }
  }
  
  // If we've exhausted all retries
  throw lastError;
}

// Initialize database connection
export async function getDb() {
    const db = await open({
        filename: path.join(process.cwd(), "app/db/songs.db"),
        driver: sqlite3.Database,
    });

  
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
    const songs = await db.all<SongRecord[]>(
      "SELECT * FROM song WHERE user = ?",
      [userUUID]
    );

    // Convert database records to Song objects
    const formattedSongs = await Promise.all(songs.map(async (song) => {
      // Get playlists for each song
      const playlists = await getPlaylistsForSong(song.id);
      
      return {
        id: song.id,
        title: song.title,
        artist_name: JSON.parse(song.artist_name),
        album: song.album,
        album_image: song.album_image,
        platform: song.platform as "Youtube" | "Spotify" | "Soundcloud",
        url: song.url,
        downloaded: !!song.downloaded,
        local: !!song.local,
        platform_added_at: song.platform_added_at,
        playlists: playlists || []
      };
    }));

    return formattedSongs;
  } catch (error) {
    console.error("Error getting songs:", error);
    throw error;
  } finally {
    await db.close();
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

export async function getLatestRefresh(email: string, platform?: string): Promise<string> {
  const db = await getDb();
  try {
    let columnName = 'last_refresh';
    
    if (platform) {
      if (platform.toLowerCase() === 'spotify') {
        columnName = 'last_refresh_spotify';
      } else if (platform.toLowerCase() === 'youtube') {
        columnName = 'last_refresh_youtube';
      }
    }
    
    const query = `SELECT ${columnName} FROM user WHERE user = ?`;
    const result = await db.get(query, [email]);
    
    // If no result or the specific column is null, return a date far in the past
    if (!result || result[columnName] === null) {
      // If the platform-specific column is null but we have a general last_refresh
      if (platform && result && result.last_refresh) {
        return result.last_refresh;
      }
      return '2000-01-01T00:00:00.000Z';
    }
    
    return result[columnName];
  } catch (error) {
    console.error("Error getting latest refresh:", error);
    // Return a date far in the past on error
    return '2000-01-01T00:00:00.000Z';
  } finally {
    await db.close();
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

  // Build the base query
  let baseQuery = 'FROM song s';
  const countQuery = 'SELECT COUNT(DISTINCT s.id) as total';
  const selectQuery = 'SELECT DISTINCT s.*';
  
  // Join with song_playlist and playlist tables if playlist filter is applied
  if (playlist) {
    baseQuery += ' JOIN song_playlist sp ON s.id = sp.song_id JOIN playlist p ON sp.playlist_id = p.id';
  }
  
  // Build the WHERE clause dynamically
  const whereConditions = [];
  const params: Array<string | number> = [];
  
  // Handle user condition - fetch songs from both accounts if available
  if (spotifyEmail && youtubeEmail) {
    whereConditions.push('(s.user = ? OR s.user = ?)');
    params.push(spotifyEmail, youtubeEmail);
  } else if (spotifyEmail) {
    whereConditions.push('s.user = ?');
    params.push(spotifyEmail);
  } else {
    whereConditions.push('s.user = ?');
    params.push(youtubeEmail);
  }

  if (search) {
    whereConditions.push('(s.title LIKE ? OR s.artist_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  if (platform) {
    whereConditions.push('s.platform = ?');
    params.push(platform);
  }

  if (playlist) {
    // Filter by playlist name
    whereConditions.push('p.name = ?');
    params.push(playlist);
  }
  
  if (songStatus) {
    if(songStatus === 'notDownloaded') {
      whereConditions.push('s.downloaded = 0');
    } else if (songStatus === 'localFiles') {
      whereConditions.push('s.local = 1');
    }
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
  
  // Get total count for pagination
  const countResult = await db.get(
    `${countQuery} ${baseQuery} ${whereClause}`,
    params
  );
  
  const total = countResult?.total || 0;
  const totalPages = Math.ceil(total / itemsPerPage);

  // Get paginated results
  const songs = await db.all(
    `${selectQuery} ${baseQuery} 
     ${whereClause}
     ORDER BY s.${sortBy} ${sortDirection}
     LIMIT ? OFFSET ?`,
    [...params, itemsPerPage, offset]
  );

  // Get playlists for each song
  const songsWithPlaylists = await Promise.all(songs.map(async (song) => {
    const playlists = await getPlaylistsForSong(song.id);
    return {
      ...song,
      artist_name: JSON.parse(song.artist_name),
      playlists: playlists
    };
  }));

  return {
    songs: songsWithPlaylists,
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
  let db = null;
  
  try {
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
    
    // Get the latest Spotify-specific refresh timestamp
    const latestRefresh = await getLatestRefresh(userEmail, 'spotify');
    
    // Get Spotify access token
    const spotifyAccessToken = await getProviderAccessToken(request, "spotify");
    
    if (!spotifyAccessToken) {
      return {
        success: false,
        message: "Could not get Spotify access token. Please reconnect your Spotify account.",
        songs: [],
        total: 0
      };
    }
    
    // Open a single database connection for the entire operation
    db = await getDb();
    
    // Begin transaction at the highest level
    await db.run('BEGIN TRANSACTION');
    
    // Process Spotify library using the same db connection
    const total = await processSpotifyLibrary(spotifyAccessToken, db, userEmail, latestRefresh);
    
    // Get current timestamp for the update
    const now = new Date().toISOString();
    
    // Update both the general and Spotify-specific refresh timestamps
    await db.run(
      "UPDATE user SET last_refresh = ?, last_refresh_spotify = ? WHERE user = ?",
      [now, now, userEmail]
    );
    
    // Commit the transaction if everything succeeds
    await db.run('COMMIT');
    
    return {
      success: true,
      message: `Successfully refreshed Spotify library. Added ${total} new songs.`,
      songs: [],
      total
    };
  } catch (error) {
    // Rollback on any error
    if (db) {
      try {
        await db.run('ROLLBACK');
      } catch (rollbackError) {
        console.error("Error during rollback:", rollbackError);
      }
    }
    
    console.error("Error refreshing Spotify library:", error);
    
    return {
      success: false,
      message: `Error refreshing Spotify library: ${error instanceof Error ? error.message : String(error)}`,
      songs: [],
      total: 0
    };
  } finally {
    // Always close the connection
    if (db) {
      try {
        await db.close();
      } catch (closeError) {
        console.error("Error closing database connection:", closeError);
      }
    }
  }
}

/**
 * Refresh YouTube library for a user
 * @param request Request object
 * @returns Object with songs and total count
 */
export async function refreshYoutubeLibrary(request: Request) {
  let db = null;
  
  try {
    const isYoutubeAuthenticated = await isAuthenticatedWithProvider(request, "youtube");
    
    if (!isYoutubeAuthenticated) {
      return {
        success: false,
        message: "You need to authenticate with YouTube first. Please connect your YouTube account.",
        songs: [],
        total: 0
      };
    }
    
    const youtubeSession = await getProviderSession(request, "youtube");
    console.log("YouTube session:", youtubeSession);
    
    const userEmail = youtubeSession?.email || '';
    console.log("User email from YouTube session:", userEmail);
    
    if (!userEmail) {
      return {
        success: false,
        message: "Could not determine user email from YouTube session. Please reconnect your YouTube account.",
        songs: [],
        total: 0
      };
    }
    
    // Get the latest YouTube-specific refresh timestamp
    const latestRefresh = await getLatestRefresh(userEmail, 'youtube');
    
    // Get YouTube access token
    const youtubeAccessToken = await getProviderAccessToken(request, "youtube");
    
    if (!youtubeAccessToken) {
      return {
        success: false,
        message: "Could not get YouTube access token. Please reconnect your YouTube account.",
        songs: [],
        total: 0
      };
    }
    
    // Open a single database connection for the entire operation
    db = await getDb();
    
    // Begin transaction at the highest level
    await db.run('BEGIN TRANSACTION');
    
    // Process YouTube library using the same db connection
    const total = await processYouTubeLibrary(youtubeAccessToken, db, userEmail, latestRefresh);
    
    // Get current timestamp for the update
    const now = new Date().toISOString();
    
    // Update both the general and YouTube-specific refresh timestamps
    await db.run(
      "UPDATE user SET last_refresh = ?, last_refresh_youtube = ? WHERE user = ?",
      [now, now, userEmail]
    );
    
    // Commit the transaction if everything succeeds
    await db.run('COMMIT');
    
    return {
      success: true,
      message: `Successfully refreshed YouTube library. Added ${total} new songs.`,
      songs: [],
      total
    };
  } catch (error) {
    // Rollback on any error
    if (db) {
      try {
        await db.run('ROLLBACK');
      } catch (rollbackError) {
        console.error("Error during rollback:", rollbackError);
      }
    }
    
    console.error("Error refreshing YouTube library:", error);
    
    return {
      success: false,
      message: `Error refreshing YouTube library: ${error instanceof Error ? error.message : String(error)}`,
      songs: [],
      total: 0
    };
  } finally {
    // Always close the connection
    if (db) {
      try {
        await db.close();
      } catch (closeError) {
        console.error("Error closing database connection:", closeError);
      }
    }
  }
}

export async function populateSongsForUser(request: Request) {
  const db = await getDb();
  let songs: Song[] = [];
  let toast: ToastMessage = { type: "success", message: "Songs refreshed successfully!" };
  let total = 0;

  try {
    // Try to get session from both providers
    const spotifySession = await getProviderSession(request, "spotify");
    const youtubeSession = await getProviderSession(request, "youtube");
    
    // Get emails from both sessions if available
    const userEmailSpotify = spotifySession?.email || '';
    const userEmailYoutube = youtubeSession?.email || '';
    
    // Check if at least one provider is authenticated
    if (!userEmailSpotify && !userEmailYoutube) {
      toast = { type: "error", message: "You need to authenticate with at least one provider." };
      return { songs, toast, total };
    }
    
    // Begin transaction
    await db.run('BEGIN TRANSACTION');
    
    // Process Spotify if authenticated
    if (spotifySession) {
      const spotifyAccessToken = await getProviderAccessToken(request, "spotify");
      if (spotifyAccessToken) {
        try {
          // Get the latest Spotify refresh timestamp
          const spotifyLatestRefresh = await getLatestRefresh(userEmailSpotify, 'spotify');
          total += await processSpotifyLibrary(spotifyAccessToken, db, userEmailSpotify, spotifyLatestRefresh);
        } catch (error) {
          console.error("Error processing Spotify library:", error);
          toast = { type: "error", message: "Error refreshing Spotify songs. Please try again." };
        }
      }
    }
    
    // Process YouTube if authenticated
    if (youtubeSession) {
      const youtubeAccessToken = await getProviderAccessToken(request, "youtube");
      if (youtubeAccessToken) {
        try {
          // Get the latest YouTube refresh timestamp
          const youtubeLatestRefresh = await getLatestRefresh(userEmailYoutube, 'youtube');
          total += await processYouTubeLibrary(youtubeAccessToken, db, userEmailYoutube, youtubeLatestRefresh);
        } catch (error) {
          console.error("Error processing YouTube library:", error);
          toast = { type: "error", message: "Error refreshing YouTube songs. Please try again." };
        }
      }
    }
    
    // Commit transaction
    await db.run('COMMIT');
    
    // Get the updated songs from DB
    const userSongs = await getUserSongsFromDB(request, {
      page: 1,
      itemsPerPage: 10
    });
    
    songs = userSongs.songs;
    
    return { songs, toast, total };
  } catch (error) {
    // Rollback transaction on error
    await db.run('ROLLBACK');
    console.error("Error populating songs:", error);
    toast = { type: "error", message: "Error refreshing songs. Please try again." };
    return { songs, toast, total };
  }
}

// Get a song by ID
export async function getSongById(id: string): Promise<Song | null> {
  const db = await getDb();
  try {
    const song = await db.get<SongRecord>(
      "SELECT * FROM song WHERE id = ?",
      [id]
    );

    if (!song) {
      return null;
    }

    // Get playlists for the song
    const playlists = await getPlaylistsForSong(song.id);

    return {
      id: song.id,
      title: song.title,
      artist_name: JSON.parse(song.artist_name),
      album: song.album,
      album_image: song.album_image,
      platform: song.platform as "Youtube" | "Spotify" | "Soundcloud",
      url: song.url,
      downloaded: !!song.downloaded,
      local: !!song.local,
      platform_added_at: song.platform_added_at,
      playlists: playlists || []
    };
  } catch (error) {
    console.error("Error getting song by ID:", error);
    throw error;
  } finally {
    await db.close();
  }
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
        `SELECT id, downloaded, local FROM song WHERE url = ? AND user = ?`,
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
      
      // Get all playlists for all duplicate tracks
      for (const track of tracks) {
        if (track.id === primaryTrack.id) continue;
        
        // Get playlists for this duplicate track
        const playlistRelations = await db.all(
          `SELECT playlist_id, added_at FROM song_playlist WHERE song_id = ?`,
          [track.id]
        );
        
        // Add each playlist to the primary track if not already there
        for (const relation of playlistRelations) {
          // Check if primary track already has this playlist
          const existingRelation = await db.get(
            `SELECT 1 FROM song_playlist WHERE song_id = ? AND playlist_id = ?`,
            [primaryTrack.id, relation.playlist_id]
          );
          
          if (!existingRelation) {
            // Add playlist to primary track
            await db.run(
              `INSERT INTO song_playlist (song_id, playlist_id, added_at) VALUES (?, ?, ?)`,
              [primaryTrack.id, relation.playlist_id, relation.added_at]
            );
          }
        }
      }
      
      // Delete all other duplicates and their playlist relations
      const idsToDelete = tracks
        .filter(t => t.id !== primaryTrack.id)
        .map(t => t.id);
      
      if (idsToDelete.length > 0) {
        // Delete playlist relations first (foreign key constraint)
        await db.run(
          `DELETE FROM song_playlist WHERE song_id IN (${idsToDelete.join(',')})`
        );
        
        // Delete duplicate songs
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
 */
export async function getAllPlaylists(userEmail: string) {
  try {
    const db = await getDb();
    
    // Get all playlists for the user from the playlist table
    const playlists = await db.all<PlaylistRecord[]>(
      `SELECT * FROM playlist WHERE user = ?`,
      [userEmail]
    );
    
    // Extract playlist names
    const playlistNames = playlists.map(p => p.name);
    
    return playlistNames;
  } catch (error) {
    console.error("Error getting all playlists:", error);
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
    console.log(`Processing Spotify library for user: ${userEmail}`);
    
    // Process liked songs - pass the db connection
    try {
      const likedSongsTotal = await processSpotifyLikedSongs(accessToken, db, userEmail, latestRefresh);
      total += likedSongsTotal;
      console.log(`Added ${likedSongsTotal} liked songs from Spotify`);
    } catch (e) {
      console.error("Error processing Spotify liked songs:", e);
      errors.push(`Liked songs error: ${e instanceof Error ? e.message : String(e)}`);
    }
    
    // Process playlists - pass the db connection
    try {
      const playlistsTotal = await processSpotifyPlaylists(accessToken, db, userEmail, latestRefresh);
      total += playlistsTotal;
      console.log(`Added ${playlistsTotal} songs from Spotify playlists`);
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
    
    // Create or get the "SpotifyLikedSongs" playlist
    const playlistName = "SpotifyLikedSongs";
    const playlistIdResult = await withRetry(async () => {
      // Use the passed db connection for savePlaylist
      return await savePlaylist(
        "spotify_liked_songs",
        playlistName,
        "Spotify",
        userEmail, // User is the owner of their liked songs
        userEmail,
        db // Pass the db connection
      );
    });
    
    if (!playlistIdResult) {
      console.error("Failed to create or get SpotifyLikedSongs playlist");
      return 0;
    }
    
    const playlistId = playlistIdResult;
    
    if (likedsongs && likedsongs.items && Array.isArray(likedsongs.items)) {
      const likedItems = likedsongs.items.filter(
        (t) => new Date(t.added_at) > new Date(latestRefresh)
      );
      
      if (likedItems && likedItems.length > 0) {
        for (const item of likedItems) {
          const artist_name = JSON.stringify(item.track.artists.map((t) => t.name));
          
          // Insert the song
          const result = await withRetry(async () => {
            return await db.run(
              `INSERT INTO song 
              (artist_name, downloaded, title, album, album_image, user, platform, url, platform_added_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                artist_name,
                0,
                item.track.name,
                item.track.album.name,
                item.track.album.images[0]?.url || '',
                userEmail,
                "Spotify",
                item.track.uri,
                new Date(item.added_at).toISOString()
              ]
            );
          });
          
          // Get the inserted song ID
          let songId: number;
          if (typeof result.lastID === 'number') {
            songId = result.lastID;
          } else {
            // Get the ID of the song we just inserted
            const insertedSong = await withRetry(async () => {
              return await db.get(
                "SELECT id FROM song WHERE url = ? AND user = ? ORDER BY id DESC LIMIT 1",
                [item.track.uri, userEmail]
              );
            });
            
            if (!insertedSong || typeof insertedSong.id !== 'number') {
              console.error("Failed to get ID of inserted song");
              continue;
            }
            
            songId = insertedSong.id;
          }
          
          // Add the song to the playlist
          await withRetry(async () => {
            // Use the passed db connection for addSongToPlaylist
            await addSongToPlaylist(songId, playlistId, new Date(item.added_at).toISOString(), db);
          });
          
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
      
      // Create or get the playlist in our database
      const playlistIdResult = await withRetry(async () => {
        return await savePlaylist(
          playlist.id,
          playlist.name,
          "Spotify",
          playlist.owner?.id || null,
          userEmail,
          db // Pass the db connection
        );
      });
      
      if (!playlistIdResult) {
        console.error(`Failed to create or get playlist: ${playlist.name}`);
        continue;
      }
      
      const playlistId = playlistIdResult;
      
      const playlistTracks = await getPlaylistTracksSpotify(accessToken, playlist.id);
      
      if (playlistTracks && playlistTracks.items.length > 0) {
        for (const item of playlistTracks.items) {
          // Check if this track was added after the latest refresh
          if (new Date(item.added_at) > new Date(latestRefresh)) {
            const artist_name = JSON.stringify(item.track.artists.map((t) => t.name));
            
            // Check if this track already exists in the database
            const existingSong = await withRetry(async () => {
              return await db.get(
                `SELECT id FROM song WHERE url = ? AND user = ?`,
                [item.track.uri, userEmail]
              );
            });
            
            if (existingSong) {
              // Track exists, add it to this playlist if not already there
              const songId = existingSong.id;
              
              // Check if song is already in this playlist
              const existingRelation = await withRetry(async () => {
                return await db.get(
                  "SELECT 1 FROM song_playlist WHERE song_id = ? AND playlist_id = ?",
                  [songId, playlistId]
                );
              });
              
              if (!existingRelation) {
                // Add song to playlist with the added_at date
                await withRetry(async () => {
                  await addSongToPlaylist(songId, playlistId, new Date(item.added_at).toISOString(), db);
                });
              }
            } else {
              // Track doesn't exist, insert new record
              const result = await withRetry(async () => {
                return await db.run(
                  `INSERT INTO song 
                  (artist_name, downloaded, title, album, album_image, user, platform, url, platform_added_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    artist_name,
                    0,
                    item.track.name,
                    item.track.album.name,
                    item.track.album.images[0]?.url || '',
                    userEmail,
                    "Spotify",
                    item.track.uri,
                    new Date(item.added_at).toISOString()
                  ]
                );
              });
              
              // Get the inserted song ID
              let songId: number;
              if (typeof result.lastID === 'number') {
                songId = result.lastID;
              } else {
                // Get the ID of the song we just inserted
                const insertedSong = await withRetry(async () => {
                  return await db.get(
                    "SELECT id FROM song WHERE url = ? AND user = ? ORDER BY id DESC LIMIT 1",
                    [item.track.uri, userEmail]
                  );
                });
                
                if (!insertedSong || typeof insertedSong.id !== 'number') {
                  console.error("Failed to get ID of inserted song");
                  continue;
                }
                
                songId = insertedSong.id;
              }
              
              // Add the song to the playlist
              await withRetry(async () => {
                await addSongToPlaylist(songId, playlistId, new Date(item.added_at).toISOString(), db);
              });
              
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
 * @param latestRefresh Latest refresh timestamp
 * @returns Number of tracks added
 */
export async function processYouTubeLibrary(accessToken: string, db: Database, userEmail: string, latestRefresh: string) {
  let total = 0;
  const errors: string[] = [];
  
  try {
    console.log(`Processing YouTube library for user: ${userEmail}`);
    
    // Process playlists - pass the db connection and latestRefresh
    try {
      const playlistsTotal = await processYouTubePlaylists(accessToken, db, userEmail, latestRefresh);
      total += playlistsTotal;
      console.log(`Added ${playlistsTotal} songs from YouTube playlists`);
    } catch (e) {
      console.error("Error processing YouTube playlists:", e);
      errors.push(`Playlists error: ${e instanceof Error ? e.message : String(e)}`);
    }
    
    // Process liked videos - pass the db connection and latestRefresh
    try {
      const likedVideosTotal = await processYouTubeLikedVideos(accessToken, db, userEmail, latestRefresh);
      total += likedVideosTotal;
      console.log(`Added ${likedVideosTotal} liked videos from YouTube`);
    } catch (e) {
      console.error("Error processing YouTube liked videos:", e);
      errors.push(`Liked videos error: ${e instanceof Error ? e.message : String(e)}`);
    }
    
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
 * @param latestRefresh Latest refresh timestamp
 * @returns Number of tracks added
 */
export async function processYouTubePlaylists(accessToken: string, db: Database, userEmail: string, latestRefresh: string) {
  let total = 0;
  
  try {
    // Get all YouTube playlists
    const playlists = await getAllUserPlaylistsYouTube(accessToken);
    
    // Process each playlist
    for (const playlist of playlists) {
      const playlistName = playlist.snippet.title;
      const playlistId = playlist.id;
      
      console.log(`Processing YouTube playlist: ${playlistName}`);
      
      // Create or get the playlist in our database
      const dbPlaylistIdResult = await withRetry(async () => {
        return await savePlaylist(
          playlistId,
          playlistName,
          "Youtube",
          userEmail, // For YouTube, the user is the owner of their playlists
          userEmail,
          db // Pass the db connection
        );
      });
      
      if (!dbPlaylistIdResult) {
        console.error(`Failed to create or get playlist: ${playlistName}`);
        continue;
      }
      
      const dbPlaylistId = dbPlaylistIdResult;
      
      // Get all videos in the playlist
      const videos = await getPlaylistVideosYouTube(accessToken, playlistId);
      
      // Convert videos to Song format with improved artist extraction
      const playlistSongs = convertYouTubeItemsToSongs(videos, playlistName);
      
      // Filter songs based on the latest refresh date
      const latestRefreshDate = new Date(latestRefresh);
      const newSongs = playlistSongs.filter(song => {
        const songDate = new Date(song.platform_added_at);
        return songDate > latestRefreshDate;
      });
      
      console.log(`Found ${newSongs.length} new songs in playlist ${playlistName} since ${latestRefresh}`);
      
      // Add songs to the database
      for (const song of newSongs) {
        // Check if song already exists by URL instead of title
        // This is more reliable since the title might change with our improved extraction
        const videoId = song.url.split('v=')[1];
        const existingSong = await withRetry(async () => {
          return await db.get(
            "SELECT id FROM song WHERE url LIKE ? AND user = ?",
            [`%${videoId}%`, userEmail]
          );
        });
        
        if (existingSong) {
          // Song exists, add it to this playlist if not already there
          const songId = existingSong.id;
          
          // Check if song is already in this playlist
          const existingRelation = await withRetry(async () => {
            return await db.get(
              "SELECT 1 FROM song_playlist WHERE song_id = ? AND playlist_id = ?",
              [songId, dbPlaylistId]
            );
          });
          
          if (!existingRelation) {
            // Add song to playlist
            await withRetry(async () => {
              await addSongToPlaylist(songId, dbPlaylistId, song.platform_added_at, db);
            });
          }
        } else {
          // Insert new song
          const result = await withRetry(async () => {
            return await db.run(
              "INSERT INTO song (title, artist_name, album, album_image, platform, url, downloaded, local, platform_added_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
              [
                song.title,
                JSON.stringify(song.artist_name),
                song.album,
                song.album_image,
                song.platform,
                song.url,
                song.downloaded ? 1 : 0,
                song.local ? 1 : 0,
                song.platform_added_at,
                userEmail
              ]
            );
          });
          
          // Get the inserted song ID
          let songId: number;
          if (typeof result.lastID === 'number') {
            songId = result.lastID;
          } else {
            // Get the ID of the song we just inserted
            const insertedSong = await withRetry(async () => {
              return await db.get(
                "SELECT id FROM song WHERE url = ? AND user = ? ORDER BY id DESC LIMIT 1",
                [song.url, userEmail]
              );
            });
            
            if (!insertedSong || typeof insertedSong.id !== 'number') {
              console.error("Failed to get ID of inserted song");
              continue;
            }
            
            songId = insertedSong.id;
          }
          
          // Add the song to the playlist
          await withRetry(async () => {
            await addSongToPlaylist(songId, dbPlaylistId, song.platform_added_at, db);
          });
          
          total++;
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
 * @param latestRefresh Latest refresh timestamp
 * @returns Number of tracks added
 */
export async function processYouTubeLikedVideos(accessToken: string, db: Database, userEmail: string, latestRefresh: string) {
  let total = 0;
  
  try {
    console.log(`Processing YouTube liked videos for user: ${userEmail}`);
    
    // Create or get the "YouTubeLikedVideos" playlist
    const playlistName = "YouTubeLikedVideos";
    const playlistIdResult = await withRetry(async () => {
      return await savePlaylist(
        "youtube_liked_videos",
        playlistName,
        "Youtube",
        userEmail, // User is the owner of their liked videos
        userEmail,
        db // Pass the db connection
      );
    });
    
    if (!playlistIdResult) {
      console.error("Failed to create or get YouTubeLikedVideos playlist");
      return 0;
    }
    
    const playlistId = playlistIdResult;
    
    // Get liked videos
    const likedVideos = await getLikedVideosYouTube(accessToken);
    
    // Convert to Song format
    const songs = convertYouTubeItemsToSongs(likedVideos, "YouTubeLikedVideos");
    
    // Filter songs based on the latest refresh date
    const latestRefreshDate = new Date(latestRefresh);
    const newSongs = songs.filter(song => {
      const songDate = new Date(song.platform_added_at);
      return songDate > latestRefreshDate;
    });
    
    console.log(`Found ${newSongs.length} new liked videos since ${latestRefresh}`);
    
    // Add songs to database
    for (const song of newSongs) {
      // Check if song already exists
      const videoId = song.url.split('v=')[1];
      const existingSong = await withRetry(async () => {
        return await db.get(
          "SELECT id FROM song WHERE url LIKE ? AND user = ?",
          [`%${videoId}%`, userEmail]
        );
      });
      
      if (existingSong) {
        // Song exists, add it to this playlist if not already there
        const songId = existingSong.id;
        
        // Check if song is already in this playlist
        const existingRelation = await withRetry(async () => {
          return await db.get(
            "SELECT 1 FROM song_playlist WHERE song_id = ? AND playlist_id = ?",
            [songId, playlistId]
          );
        });
        
        if (!existingRelation) {
          // Add song to playlist
          await withRetry(async () => {
            await addSongToPlaylist(songId, playlistId, song.platform_added_at, db);
          });
        }
      } else {
        // Insert new song
        const result = await withRetry(async () => {
          return await db.run(
            "INSERT INTO song (title, artist_name, album, album_image, platform, url, downloaded, local, platform_added_at, user) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
              song.title,
              JSON.stringify(song.artist_name),
              song.album,
              song.album_image,
              song.platform,
              song.url,
              song.downloaded ? 1 : 0,
              song.local ? 1 : 0,
              song.platform_added_at,
              userEmail
            ]
          );
        });
        
        // Get the inserted song ID
        let songId: number;
        if (typeof result.lastID === 'number') {
          songId = result.lastID;
        } else {
          // Get the ID of the song we just inserted
          const insertedSong = await withRetry(async () => {
            return await db.get(
              "SELECT id FROM song WHERE url = ? AND user = ? ORDER BY id DESC LIMIT 1",
              [song.url, userEmail]
            );
          });
          
          if (!insertedSong || typeof insertedSong.id !== 'number') {
            console.error("Failed to get ID of inserted song");
            continue;
          }
          
          songId = insertedSong.id;
        }
        
        // Add the song to the playlist
        await withRetry(async () => {
          await addSongToPlaylist(songId, playlistId, song.platform_added_at, db);
        });
        
        total++;
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
    // Insert the song
    const result = await db.run(
      `INSERT INTO song (
        title, 
        artist_name, 
        album_image, 
        album, 
        platform, 
        url, 
        downloaded, 
        local, 
        platform_added_at,
        user
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        JSON.stringify(artistName),
        thumbnailUrl,
        "Custom URL",
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
    
    // Create a "Custom URL" playlist if it doesn't exist
    const customPlaylist = await getPlaylistByPlatformId("custom_url", platform, userId);
    let playlistId: number;
    
    if (customPlaylist) {
      playlistId = customPlaylist.id;
    } else {
      const newPlaylistId = await savePlaylist(
        "custom_url",
        "Custom URL",
        platform,
        userId, // User is the owner
        userId
      );
      
      if (typeof newPlaylistId === 'undefined') {
        throw new Error("Failed to create Custom URL playlist");
      }
      
      playlistId = newPlaylistId;
    }
    
    // Add the song to the Custom URL playlist
    if (typeof result.lastID === 'number') {
      await addSongToPlaylist(result.lastID, playlistId);
    }
    
    return result.lastID || 0; // Ensure we return a number
  } catch (error) {
    console.error("Error saving custom URL song:", error);
    throw error;
  }
}

// Playlist Management Functions

// Get all playlists for a user
export async function getPlaylists(userUUID: string) {
  const db = await getDb();
  try {
    const playlists = await db.all<PlaylistRecord[]>(
      "SELECT * FROM playlist WHERE user = ?",
      [userUUID]
    );
    return playlists;
  } catch (error) {
    console.error("Error getting playlists:", error);
    throw error;
  } finally {
    await db.close();
  }
}

// Get a playlist by ID
export async function getPlaylistById(playlistId: number) {
  const db = await getDb();
  try {
    const playlist = await db.get<PlaylistRecord>(
      "SELECT * FROM playlist WHERE id = ?",
      [playlistId]
    );
    return playlist;
  } catch (error) {
    console.error("Error getting playlist:", error);
    throw error;
  } finally {
    await db.close();
  }
}

// Get a playlist by platform ID
export async function getPlaylistByPlatformId(platformId: string, platform: string, userUUID: string) {
  const db = await getDb();
  try {
    const playlist = await db.get<PlaylistRecord>(
      "SELECT * FROM playlist WHERE platform_playlist_id = ? AND platform = ? AND user = ?",
      [platformId, platform, userUUID]
    );
    return playlist;
  } catch (error) {
    console.error("Error getting playlist by platform ID:", error);
    throw error;
  } finally {
    await db.close();
  }
}

// Create or update a playlist
export async function savePlaylist(
  platformPlaylistId: string,
  name: string,
  platform: string,
  ownerId: string | null,
  userUUID: string,
  existingDb?: Database
) {
  let db: Database | null = existingDb || null;
  const localConnection = !existingDb;
  
  try {
    if (localConnection) {
      db = await getDb();
    }
    
    return await withRetry(async () => {
      // Check if playlist already exists
      const existingPlaylist = await db!.get<PlaylistRecord>(
        "SELECT * FROM playlist WHERE platform_playlist_id = ? AND platform = ? AND user = ?",
        [platformPlaylistId, platform, userUUID]
      );

      if (existingPlaylist) {
        // Update existing playlist
        await db!.run(
          "UPDATE playlist SET name = ?, owner_id = ? WHERE id = ?",
          [name, ownerId, existingPlaylist.id]
        );
        return existingPlaylist.id;
      } else {
        // Insert new playlist
        const result = await db!.run(
          "INSERT INTO playlist (platform_playlist_id, name, platform, owner_id, user) VALUES (?, ?, ?, ?, ?)",
          [platformPlaylistId, name, platform, ownerId, userUUID]
        );
        return result.lastID;
      }
    });
  } catch (error) {
    console.error("Error saving playlist:", error);
    throw error;
  } finally {
    // Only close the connection if we opened it
    if (localConnection && db) {
      await db.close();
    }
  }
}

// Get all songs in a playlist
export async function getSongsInPlaylist(playlistId: number) {
  const db = await getDb();
  try {
    const songs = await db.all<SongRecord[]>(
      `SELECT s.* 
       FROM song s
       JOIN song_playlist sp ON s.id = sp.song_id
       WHERE sp.playlist_id = ?`,
      [playlistId]
    );
    return songs;
  } catch (error) {
    console.error("Error getting songs in playlist:", error);
    throw error;
  } finally {
    await db.close();
  }
}

// Add a song to a playlist
export async function addSongToPlaylist(
  songId: number, 
  playlistId: number, 
  addedAt: string = new Date().toISOString(),
  existingDb?: Database
) {
  let db: Database | null = existingDb || null;
  const localConnection = !existingDb;
  
  try {
    if (localConnection) {
      db = await getDb();
    }
    
    await withRetry(async () => {
      // Check if relationship already exists
      const existingRelation = await db!.get<SongPlaylist>(
        "SELECT 1 FROM song_playlist WHERE song_id = ? AND playlist_id = ?",
        [songId, playlistId]
      );

      if (!existingRelation) {
        await db!.run(
          "INSERT INTO song_playlist (song_id, playlist_id, added_at) VALUES (?, ?, ?)",
          [songId, playlistId, addedAt]
        );
      }
    });
  } catch (error) {
    console.error("Error adding song to playlist:", error);
    throw error;
  } finally {
    // Only close the connection if we opened it
    if (localConnection && db) {
      await db.close();
    }
  }
}

// Get all playlists for a song
export async function getPlaylistsForSong(songId: number) {
  const db = await getDb();
  try {
    const playlists = await db.all<PlaylistRecord[]>(
      `SELECT p.*, sp.added_at 
       FROM playlist p
       JOIN song_playlist sp ON p.id = sp.playlist_id
       WHERE sp.song_id = ?`,
      [songId]
    );
    return playlists;
  } catch (error) {
    console.error("Error getting playlists for song:", error);
    throw error;
  } finally {
    await db.close();
  }
}

// Get user-owned playlists
export async function getUserOwnedPlaylists(userUUID: string, platform: string) {
  const db = await getDb();
  try {
    const playlists = await db.all<PlaylistRecord[]>(
      "SELECT * FROM playlist WHERE user = ? AND platform = ? AND owner_id = ?",
      [userUUID, platform, userUUID]
    );
    return playlists;
  } catch (error) {
    console.error("Error getting user-owned playlists:", error);
    throw error;
  } finally {
    await db.close();
  }
}