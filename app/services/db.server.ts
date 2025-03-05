import sqlite3 from 'sqlite3';
import { open } from "sqlite";
import { getProviderAccessToken, isAuthenticatedWithProvider, getProviderSession } from "./auth.server";
import { getLikedSongsSpotify, getAllUserPlaylistsSpotify, getPlaylistTracksSpotify } from "./selfApi.server";
import { getAllUserPlaylistsYouTube, getPlaylistVideosYouTube, convertYouTubeItemsToSongs, getLikedVideosYouTube } from "./youtubeApi.server";

import path from "path";
import { Song } from '~/types/customs';
import fs from 'fs/promises';
import { ToastMessage } from 'remix-toast';

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
  
  // Try to get session from either provider
  const spotifySession = await getProviderSession(request, "spotify");
  const youtubeSession = await getProviderSession(request, "youtube");
  
  // Use the first available session
  const userEmail = spotifySession?.email || youtubeSession?.email || '';
  
  if (!userEmail) {
    throw new Error("User not authenticated");
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
  const whereConditions = ['user = ?'];
  const params: Array<string | number> = [userEmail];

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



export async function populateSongsForUser(request: Request) {
  const db = await getDb();
  
  // Check if user is authenticated with either provider
  const isSpotifyAuthenticated = await isAuthenticatedWithProvider(request, "spotify");
  const isYoutubeAuthenticated = await isAuthenticatedWithProvider(request, "youtube");
  
  if (!isSpotifyAuthenticated && !isYoutubeAuthenticated) {
    throw new Error("User not authenticated with any provider");
  }
  
  // Determine which provider to use
  const provider = isSpotifyAuthenticated ? "spotify" : "youtube";
  
  // Get access token for the active provider
  const accessToken = await getProviderAccessToken(request, provider);
  
  if (!accessToken) {
    throw new Error("No access token available");
  }
  
  // Get user email from session
  let userEmail = "";
  if (provider === "spotify") {
    const spotifySession = await getProviderSession(request, "spotify");
    userEmail = spotifySession?.email || "";
  } else {
    const youtubeSession = await getProviderSession(request, "youtube");
    userEmail = youtubeSession?.email || "";
  }
  
  if (!userEmail) {
    throw new Error("No user email available");
  }
  
  // Store user in database if not exists
  await db.run("INSERT OR IGNORE INTO user (user, last_refresh) VALUES (?, ?)", [
    userEmail,
    new Date().toISOString(),
  ]);
  
  // Update last refresh time
  await db.run("UPDATE user SET last_refresh = ? WHERE user = ?", [
    new Date().toISOString(),
    userEmail,
  ]);
  
  let songs: Song[] = [];
  let toast: ToastMessage = { type: "success", message: "Songs refreshed successfully!" };
  let total = 0;
  
  try {
    if (provider === "spotify") {
      // Existing Spotify code - we'll keep this part as is
      const latestRefresh = await getLatestRefresh(userEmail);
      
      // Begin transaction
      await db.run('BEGIN TRANSACTION');
      
      // 1. Process liked songs
      const likedsongs = await getLikedSongsSpotify(0, 50, accessToken);
      
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
            total++;
          }
        }
      }
      
      // 2. Process all user playlists
      const playlists = await getAllUserPlaylistsSpotify(accessToken);
      
      for (const playlist of playlists) {
        console.log(`Processing playlist: ${playlist.name}`);
        
        const playlistTracks = await getPlaylistTracksSpotify(accessToken, playlist.id);
        
        if (playlistTracks && playlistTracks.items.length > 0) {
          for (const item of playlistTracks.items) {
            // Check if this track was added after the latest refresh
            if (new Date(item.added_at) > new Date(latestRefresh)) {
              const artist_name = JSON.stringify(item.track.artists.map((t) => t.name));
              
              // Check if this track already exists in the database
              const existingSong = await db.get(
                `SELECT id, playlist FROM song WHERE url = ? AND user = ?`,
                [item.track.uri, userEmail]
              );
              
              if (existingSong) {
                // Track exists, update the playlist array to include this playlist
                const existingPlaylists = JSON.parse(existingSong.playlist || '[]');
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
      
      // Commit transaction
      await db.run('COMMIT');
      
    } else if (provider === "youtube") {
      // Get all YouTube playlists
      const playlists = await getAllUserPlaylistsYouTube(accessToken);
      
      // Process each playlist
      for (const playlist of playlists) {
        const playlistName = playlist.snippet.title;
        const playlistId = playlist.id;
        
        // Get all videos in the playlist
        const videos = await getPlaylistVideosYouTube(accessToken, playlistId);
        
        // Convert videos to Song format
        const playlistSongs = convertYouTubeItemsToSongs(videos, playlistName);
        
        // Add songs to the database
        for (const song of playlistSongs) {
          const existingSong = await db.get(
            "SELECT * FROM song WHERE title = ? AND platform = ? AND user = ?",
            [song.title, song.platform, userEmail]
          );
          
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
            if (!existingPlaylists.includes(playlistName)) {
              existingPlaylists.push(playlistName);
              await db.run(
                "UPDATE song SET playlist = ? WHERE id = ?",
                [JSON.stringify(existingPlaylists), existingSong.id]
              );
            }
          }
        }
        
        songs = songs.concat(playlistSongs);
      }
      
      // Get liked videos
      try {
        const likedVideos = await getLikedVideosYouTube(accessToken);
        const likedSongs = convertYouTubeItemsToSongs(likedVideos, "Liked Videos");
        
        // Add liked songs to the database
        for (const song of likedSongs) {
          const existingSong = await db.get(
            "SELECT * FROM song WHERE title = ? AND platform = ? AND user = ?",
            [song.title, song.platform, userEmail]
          );
          
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
        
        songs = songs.concat(likedSongs);
      } catch (error) {
        console.error("Error fetching liked videos:", error);
        toast = { type: "error", message: "Error fetching liked videos. Other playlists were processed successfully." };
      }
    }
    
    return { songs, toast, total };
  } catch (error) {
    console.error("Error populating songs:", error);
    toast = { type: "error", message: "Error refreshing songs. Please try again." };
    return { songs, toast, total };
  }
}

export async function getSongById(id: string): Promise<Song | null> {
  const db = await getDb();
  const song = await db.get("SELECT * FROM song WHERE id = ?", id);
  return song || null;
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
 * Get all filter options (platforms and playlists) for a specific user
 */
export async function getFilters(userEmail: string) {
  try {
    const platforms = await getAllPlatforms(userEmail);
    const playlists = await getAllPlaylists(userEmail);
    
    return {
      platforms,
      playlists
    };
  } catch (error) {
    console.error("Error fetching filters:", error);
    return {
      platforms: [],
      playlists: []
    };
  }
}