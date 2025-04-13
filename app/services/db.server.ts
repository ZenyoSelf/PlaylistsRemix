import { Database, open } from "sqlite";
import sqlite3 from "sqlite3";
import { getProviderAccessToken, isAuthenticatedWithProvider, getProviderSession } from "./auth.server";
import { getLikedSongsSpotify, getAllUserPlaylistsSpotify, getPlaylistTracksSpotify } from "./selfApi.server";
import { getAllUserPlaylistsYouTube, getPlaylistVideosYouTube, convertYouTubeItemsToSongs } from "./youtubeApi.server";

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

export async function getSongs(userId: number) {
  const db = await getDb();
  try {
    const songs = await db.all<SongRecord[]>(
      "SELECT * FROM song WHERE user_id = ?",
      [userId]
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

/**
 * Mark songs as downloaded based on a date filter and optional playlist ownership filter
 * @param request Request object
 * @param beforeDate Date string - mark songs added before this date
 * @param onlyMyPlaylists Whether to only include songs from playlists owned by the user
 * @param excludedPlaylists Array of playlist names to exclude
 * @returns Number of songs updated
 */
export async function markSongsAsDownloadedBeforeDate(
  request: Request,
  beforeDate: string,
  onlyMyPlaylists: boolean = false,
  excludedPlaylists: string[] = []
): Promise<number> {
  const db = await getDb();
  
  try {
    // Get user info from session
    const spotifySession = await getProviderSession(request, "spotify");
    const youtubeSession = await getProviderSession(request, "youtube");
    
    // Get emails from both sessions if available
    const spotifyEmail = spotifySession?.email || '';
    const youtubeEmail = youtubeSession?.email || '';
    
    // Check if at least one provider is authenticated
    if (!spotifyEmail && !youtubeEmail) {
      throw new Error("User not authenticated with any provider");
    }
    
    // Get the user ID
    const userQuery = await db.get(
      "SELECT id FROM user WHERE user_spotify = ? OR user_youtube = ?",
      [spotifyEmail, youtubeEmail]
    );
    const userId = userQuery?.id;
    if (!userId) {
      throw new Error("User not found in database");
    }
    
    // Start building the query
    let query = "UPDATE song SET downloaded = 1 WHERE user_id = ? AND platform_added_at < ? AND downloaded = 0";
    const params: (string | number)[] = [userId, beforeDate];
    
    // If filtering by user's playlists or excluding playlists, we need to join with song_playlist and playlist tables
    if (onlyMyPlaylists || excludedPlaylists.length > 0) {
      // We need to use a subquery to identify songs that are in playlists owned by the user
      query = `
        UPDATE song 
        SET downloaded = 1 
        WHERE user_id = ? 
        AND platform_added_at < ? 
        AND downloaded = 0
        AND id IN (
          SELECT DISTINCT s.id
          FROM song s
          JOIN song_playlist sp ON s.id = sp.song_id
          JOIN playlist p ON sp.playlist_id = p.id
          WHERE s.user_id = ?`;
      
      params.push(userId);
      
      // Add owner conditions if filtering by user's playlists
      if (onlyMyPlaylists) {
        query += " AND (";
        
        const ownerConditions = [];
        const ownerParams = [];
        
        if (spotifySession?.email) {
          ownerConditions.push('p.owner_id = ?');
          ownerParams.push(spotifySession.email);
          // Also check for username without domain
          const emailParts = spotifySession.email.split('@');
          const usernameOnly = emailParts[0];
          ownerConditions.push('p.owner_id = ?');
          ownerParams.push(usernameOnly);
        }
        
        if (youtubeSession?.email) {
          ownerConditions.push('p.owner_id = ?');
          ownerParams.push(youtubeSession.email);
          // Also check for username without domain
          const emailParts = youtubeSession.email.split('@');
          const usernameOnly = emailParts[0];
          ownerConditions.push('p.owner_id = ?');
          ownerParams.push(usernameOnly);
        }
        
        query += ownerConditions.join(' OR ') + ')';
        params.push(...ownerParams);
      }
      
      // Add excluded playlists condition
      if (excludedPlaylists.length > 0) {
        query += `
          AND NOT (
            s.id IN (
              SELECT DISTINCT sp1.song_id 
              FROM song_playlist sp1 
              JOIN playlist p1 ON sp1.playlist_id = p1.id 
              WHERE p1.name IN (${excludedPlaylists.map(() => '?').join(',')})
            )
            AND s.id NOT IN (
              SELECT DISTINCT sp2.song_id 
              FROM song_playlist sp2 
              JOIN playlist p2 ON sp2.playlist_id = p2.id 
              WHERE p2.name NOT IN (${excludedPlaylists.map(() => '?').join(',')})
            )
          )
        `;
        
        // Add the excluded playlist names twice (once for each subquery)
        params.push(...excludedPlaylists, ...excludedPlaylists);
      }
      
      query += ')';
    }
    
    // Execute the update query
    const result = await db.run(query, params);
    
    return result.changes || 0;
  } catch (error) {
    console.error("Error marking songs as downloaded:", error);
    throw error;
  } finally {
    await db.close();
  }
}

export async function getLatestRefresh(email: string, platform: string): Promise<string> {
  const db = await getDb();
  try {
    let columnName, userColumn;

    if (platform.toLowerCase() === 'spotify') {
      columnName = 'last_refresh_spotify';
      userColumn = 'user_spotify';
    } else if (platform.toLowerCase() === 'youtube') {
      columnName = 'last_refresh_youtube';
      userColumn = 'user_youtube';
    } else {
      throw new Error(`Invalid platform: ${platform}`);
    }

    console.log(`Getting ${columnName} for ${userColumn}: ${email}`);
    const query = `SELECT ${columnName} FROM user WHERE ${userColumn} = ?`;
    const result = await db.get(query, [email]);
    console.log(`Result for ${email} (${columnName}):`, result);

    // If no result or the column is null, return a date far in the past
    if (!result || result[columnName] === null) {
      console.log(`No refresh timestamp found for ${email} (${platform}), using default date`);
      return '2000-01-01T00:00:00.000Z';
    }

    console.log(`Returning ${columnName} for ${email}:`, result[columnName]);
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
    songStatus?: string;
    sortBy?: string;
    sortDirection?: 'asc' | 'desc';
    onlyMyPlaylists?: boolean;
    excludedPlaylists?: string[];
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
    sortDirection = 'desc',
    onlyMyPlaylists = false,
    excludedPlaylists = []
  } = options;

  const offset = (page - 1) * itemsPerPage;

  // Get the user ID from either spotify or youtube email
  let userId;
  try {
    const userQuery = await db.get(
      "SELECT id FROM user WHERE user_spotify = ? OR user_youtube = ?",
      [spotifyEmail, youtubeEmail]
    );
    userId = userQuery?.id;
    if (!userId) {
      throw new Error("User not found in database");
    }
  } catch (error) {
    console.error("Error getting user ID:", error);
    throw new Error("Failed to get user ID");
  }
  
  // Build the base query
  let baseQuery = 'FROM song s';
  const countQuery = 'SELECT COUNT(DISTINCT s.id) as total';
  const selectQuery = 'SELECT DISTINCT s.*';

  // Join with song_playlist and playlist tables if playlist filter is applied or if filtering by user's playlists
  if (playlist || onlyMyPlaylists || excludedPlaylists.length > 0) {
    baseQuery += ' JOIN song_playlist sp ON s.id = sp.song_id JOIN playlist p ON sp.playlist_id = p.id';
  }

  // Build the WHERE clause dynamically
  const whereConditions = [];
  const params: Array<string | number> = [];

  whereConditions.push('s.user_id = ?');
  params.push(userId);

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

  if (onlyMyPlaylists) {
    // Filter by owner_id based on active sessions
    if (spotifySession?.email || youtubeSession?.email) {
      const ownerIds = [];
      const ownerParams = [];

      if (spotifySession?.email) {
        ownerIds.push('p.owner_id = ?');
        ownerParams.push(spotifySession.email);
        const emailParts = spotifySession?.email.split('@');
        const usernameOnly = emailParts[0];
        ownerIds.push('p.owner_id = ?');
        ownerParams.push(usernameOnly);
      }

      if (youtubeSession?.email) {
        ownerIds.push('p.owner_id = ?');
        ownerParams.push(youtubeSession.email);
        const emailParts = youtubeSession?.email.split('@');
        const usernameOnly = emailParts[0];
        ownerIds.push('p.owner_id = ?');
        ownerParams.push(usernameOnly);
      }

      whereConditions.push(`(${ownerIds.join(' OR ')})`);
      params.push(...ownerParams);
    }
  }

  // Exclude songs that are only in excluded playlists
  if (excludedPlaylists.length > 0) {
    // This complex subquery ensures we only exclude songs that ONLY exist in excluded playlists
    // If a song is in both an excluded playlist and a non-excluded playlist, it will still be shown
    whereConditions.push(`
      NOT (
        s.id IN (
          SELECT DISTINCT sp1.song_id 
          FROM song_playlist sp1 
          JOIN playlist p1 ON sp1.playlist_id = p1.id 
          WHERE p1.name IN (${excludedPlaylists.map(() => '?').join(',')})
        )
        AND s.id NOT IN (
          SELECT DISTINCT sp2.song_id 
          FROM song_playlist sp2 
          JOIN playlist p2 ON sp2.playlist_id = p2.id 
          WHERE p2.name NOT IN (${excludedPlaylists.map(() => '?').join(',')})
        )
      )
    `);
    
    // Add the excluded playlist names twice (once for each subquery)
    params.push(...excludedPlaylists, ...excludedPlaylists);
  }

  if (songStatus) {
    if (songStatus === 'notDownloaded') {
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

    // Get or create user ID
    const userId = await getUserId(db, userEmail, 'spotify');

    // Process Spotify library using the same db connection
    const total = await processSpotifyLibrary(spotifyAccessToken, db, userEmail, latestRefresh, userId);

    // Get current timestamp for the update
    const now = new Date().toISOString();

    // Update the Spotify-specific refresh timestamp
    console.log(`Updating refresh timestamp for Spotify user: ${userEmail} (ID: ${userId})`);
    await db.run(
      "UPDATE user SET last_refresh_spotify = ? WHERE id = ?",
      [now, userId]
    );

    // Verify the update
    const updatedUser = await db.get("SELECT * FROM user WHERE id = ?", [userId]);
    console.log("Updated user record:", updatedUser);

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

    // Get or create user ID
    const userId = await getUserId(db, userEmail, 'youtube');

    // Process YouTube library using the same db connection
    const total = await processYouTubeLibrary(youtubeAccessToken, db, userEmail, latestRefresh, userId);

    // Get current timestamp for the update
    const now = new Date().toISOString();

    // Update the YouTube-specific refresh timestamp
    console.log(`Updating refresh timestamp for YouTube user: ${userEmail} (ID: ${userId})`);
    await db.run(
      "UPDATE user SET last_refresh_youtube = ? WHERE id = ?",
      [now, userId]
    );

    // Verify the update
    const updatedUser = await db.get("SELECT * FROM user WHERE id = ?", [userId]);
    console.log("Updated user record:", updatedUser);

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
          const spotifyUserId = await getUserId(db, userEmailSpotify, 'spotify');
          total += await processSpotifyLibrary(spotifyAccessToken, db, userEmailSpotify, spotifyLatestRefresh, spotifyUserId);
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
          const youtubeUserId = await getUserId(db, userEmailYoutube, 'youtube');
          total += await processYouTubeLibrary(youtubeAccessToken, db, userEmailYoutube, youtubeLatestRefresh, youtubeUserId);
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
        `SELECT id, downloaded, local FROM song WHERE url = ? AND user_id = ?`,
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
export async function getAllPlatforms(userEmail: string, platform: string) {
  try {
    const db = await getDb();
    let userId: number;
    if (platform === "spotify") {
      userId = await getUserId(db, userEmail, "spotify");
    } else {
      userId = await getUserId(db, userEmail, "youtube");
    }
    const platforms = await db.all(
      `SELECT DISTINCT platform FROM song WHERE user_id = ?`,
      [userId]
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
export async function getAllPlaylists(userEmail: string, platform: string) {
  try {
    const db = await getDb();
    let userId: number;
    if (platform === "spotify") {
      userId = await getUserId(db, userEmail, "spotify");
    } else {
      userId = await getUserId(db, userEmail, "youtube");
    }


    // Get all playlists for the user from the playlist table
    const playlists = await db.all<PlaylistRecord[]>(
      `SELECT * FROM playlist WHERE user_id = ?`,
      [userId]
    );

    // Return playlist objects with name and platform
    return playlists.map(p => ({
      name: p.name,
      platform: p.platform
    }));
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
    let playlists: { name: string, platform: string }[] = [];

    // Get platforms and playlists for Spotify user
    if (spotifyEmail) {
      platforms = platforms.concat(await getAllPlatforms(spotifyEmail, "spotify"));
      playlists = playlists.concat(await getAllPlaylists(spotifyEmail, "spotify"));
    }

    // Get platforms and playlists for YouTube user
    if (youtubeEmail) {
      platforms = platforms.concat(await getAllPlatforms(youtubeEmail, "youtube"));
      playlists = playlists.concat(await getAllPlaylists(youtubeEmail, "youtube"));
    }

    // Remove duplicates
    const uniquePlatforms = [...new Set(platforms)];
    
    // For playlists, we need to deduplicate based on name
    const playlistMap = new Map<string, { name: string, platform: string }>();
    playlists.forEach(playlist => {
      playlistMap.set(playlist.name, playlist);
    });
    const uniquePlaylists = Array.from(playlistMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    return {
      platforms: uniquePlatforms,
      playlists: uniquePlaylists
    };
  } catch (error) {
    console.error("Error fetching filters:", error);
    return {
      platforms: [],
      playlists: []
    };
  }
}

export async function getSongsByIds(songIds: string[]) {
  const db = await getDb();
  const songs = await db.all(`SELECT * FROM song WHERE id IN (${songIds.join(',')})`);

  await db.close();
  return songs;
}


/**
 * Get user ID from email and platform
 * @param db Database connection
 * @param email User email
 * @param platform Platform ('spotify' or 'youtube')
 * @returns User ID or 0 if not found
 */
export async function getUserId(db: Database, email: string, platform: string): Promise<number> {
  const userColumn = platform.toLowerCase() === 'spotify' ? 'user_spotify' : 'user_youtube';
  const result = await db.get(`SELECT id FROM user WHERE ${userColumn} = ?`, [email]);

  if (result && typeof result.id === 'number') {
    return result.id;
  }

  // Create a new user record if not found
  const now = new Date().toISOString();
  let insertSql, params;

  if (platform.toLowerCase() === 'spotify') {
    insertSql = "INSERT INTO user (user_spotify, last_refresh_spotify) VALUES (?, ?)";
    params = [email, now];
  } else {
    insertSql = "INSERT INTO user (user_youtube, last_refresh_youtube) VALUES (?, ?)";
    params = [email, now];
  }

  const insertResult = await db.run(insertSql, params);
  return typeof insertResult.lastID === 'number' ? insertResult.lastID : 0;
}

/**
 * Process Spotify library for a user - fetches liked songs and playlists
 * @param accessToken Spotify access token
 * @param db Database connection
 * @param userEmail User's email
 * @param latestRefresh Latest refresh timestamp
 * @param userId User ID
 * @returns Number of tracks added
 */
export async function processSpotifyLibrary(
  accessToken: string,
  db: Database,
  userEmail: string,
  latestRefresh: string,
  userId: number
) {
  let total = 0;
  const errors: string[] = [];

  try {
    console.log(`Processing Spotify library for user: ${userEmail} (ID: ${userId})`);

    // Process liked songs - pass the db connection and userId
    try {
      const likedSongsTotal = await processSpotifyLikedSongs(accessToken, db, userEmail, latestRefresh, userId);
      total += likedSongsTotal;
      console.log(`Added ${likedSongsTotal} liked songs from Spotify`);
    } catch (e) {
      console.error("Error processing Spotify liked songs:", e);
      errors.push(`Liked songs error: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Process playlists - pass the db connection and userId
    try {
      const playlistsTotal = await processSpotifyPlaylists(accessToken, db, userEmail, latestRefresh, userId);
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
 * @param userId User ID
 * @returns Number of tracks added
 */
export async function processSpotifyLikedSongs(
  accessToken: string,
  db: Database,
  userEmail: string,
  latestRefresh: string,
  userId: number
) {
  let total = 0;

  try {
    console.log(`Processing Spotify liked songs for user: ${userEmail} (ID: ${userId})`);

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
        userId,
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
              (artist_name, downloaded, title, album, album_image, user_id, platform, url, platform_added_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                artist_name,
                0,
                item.track.name,
                item.track.album.name,
                item.track.album.images[0]?.url || '',
                userId,
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
                "SELECT id FROM song WHERE url = ? AND user_id = ? ORDER BY id DESC LIMIT 1",
                [item.track.uri, userId]
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
 * @param userId User ID
 * @returns Number of tracks added
 */
export async function processSpotifyPlaylists(
  accessToken: string,
  db: Database,
  userEmail: string,
  latestRefresh: string,
  userId: number
) {
  let total = 0;

  try {
    console.log(`Processing Spotify playlists for user: ${userEmail} (ID: ${userId})`);

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
          userId,
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
                `SELECT id FROM song WHERE url = ? AND user_id = ?`,
                [item.track.uri, userId]
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
                  (artist_name, downloaded, title, album, album_image, user_id, platform, url, platform_added_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [
                    artist_name,
                    0,
                    item.track.name,
                    item.track.album.name,
                    item.track.album.images[0]?.url || '',
                    userId,
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
                    "SELECT id FROM song WHERE url = ? AND user_id = ? ORDER BY id DESC LIMIT 1",
                    [item.track.uri, userId]
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
export async function processYouTubeLibrary(
  accessToken: string,
  db: Database,
  userEmail: string,
  latestRefresh: string,
  userId: number
) {
  let total = 0;
  const errors: string[] = [];

  try {
    console.log(`Processing YouTube library for user: ${userEmail} (ID: ${userId})`);

    // Process playlists - pass the db connection and userId
    try {
      const playlistsTotal = await processYouTubePlaylists(accessToken, db, userEmail, latestRefresh, userId);
      total += playlistsTotal;
      console.log(`Added ${playlistsTotal} songs from YouTube playlists`);
    } catch (e) {
      console.error("Error processing YouTube playlists:", e);
      errors.push(`Playlists error: ${e instanceof Error ? e.message : String(e)}`);
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
export async function processYouTubePlaylists(
  accessToken: string,
  db: Database,
  userEmail: string,
  latestRefresh: string,
  userId: number
) {
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
          userId,
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
            "SELECT id FROM song WHERE url LIKE ? AND user_id = ?",
            [`%${videoId}%`, userId]
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
              "INSERT INTO song (title, artist_name, album, album_image, platform, url, downloaded, local, platform_added_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
                userId
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
                "SELECT id FROM song WHERE url = ? AND user_id = ? ORDER BY id DESC LIMIT 1",
                [song.url, userId]
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


export async function saveCustomUrlSong(
  url: string,
  title: string,
  artistName: string[],
  thumbnailUrl: string,
  platform: string,
  userId: number
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
        user_id
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
        "SELECT id FROM song WHERE url = ? AND user_id = ?",
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
        userId.toString(), // User is the owner
        userId
      );

      if (typeof newPlaylistId === 'undefined') {
        throw new Error("Failed to create Custom URL playlist");
      }

      playlistId = newPlaylistId;
    }

    // Add the song to the playlist
    if (typeof result.lastID === 'number') {
      await addSongToPlaylist(result.lastID, playlistId);
    }

    return result.lastID || 0; // Ensure we return a number
  } catch (error) {
    console.error("Error saving custom URL song:", error);
    throw error;
  } finally {
    await db.close();
  }
}

// Playlist Management Functions

// Get all playlists for a user
export async function getPlaylists(userId: number) {
  const db = await getDb();
  try {
    const playlists = await db.all<PlaylistRecord[]>(
      "SELECT * FROM playlist WHERE user_id = ?",
      [userId]
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
export async function getPlaylistByPlatformId(platformId: string, platform: string, userId: number) {
  const db = await getDb();
  try {
    const playlist = await db.get<PlaylistRecord>(
      "SELECT * FROM playlist WHERE platform_playlist_id = ? AND platform = ? AND user_id = ?",
      [platformId, platform, userId]
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
  userId: number,
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
        "SELECT * FROM playlist WHERE platform_playlist_id = ? AND platform = ? AND user_id = ?",
        [platformPlaylistId, platform, userId]
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
          "INSERT INTO playlist (platform_playlist_id, name, platform, owner_id, user_id) VALUES (?, ?, ?, ?, ?)",
          [platformPlaylistId, name, platform, ownerId, userId]
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
export async function getUserOwnedPlaylists(userId: number, platform: string) {
  const db = await getDb();
  try {
    const playlists = await db.all<PlaylistRecord[]>(
      "SELECT * FROM playlist WHERE user_id = ? AND platform = ? AND owner_id = ?",
      [userId, platform, userId]
    );
    return playlists;
  } catch (error) {
    console.error("Error getting user-owned playlists:", error);
    throw error;
  } finally {
    await db.close();
  }
}

/**
 * Get all song IDs that match the filter criteria without pagination
 * Used specifically for bulk download functionality
 */
export async function getAllSongIdsWithFilter(
  request: Request,
  options: {
    search?: string;
    platform?: string;
    playlist?: string;
    songStatus?: string;
    onlyMyPlaylists?: boolean;
    excludedPlaylists?: string[];
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
    search = '',
    platform = '',
    playlist = '',
    songStatus = '',
    onlyMyPlaylists = false,
    excludedPlaylists = []
  } = options;

  // Get the user ID from either spotify or youtube email
  let userId;
  try {
    const userQuery = await db.get(
      "SELECT id FROM user WHERE user_spotify = ? OR user_youtube = ?",
      [spotifyEmail, youtubeEmail]
    );
    userId = userQuery?.id;
    if (!userId) {
      throw new Error("User not found in database");
    }
  } catch (error) {
    console.error("Error getting user ID:", error);
    throw new Error("Failed to get user ID");
  }

  // Build the base query - only select IDs for efficiency
  let baseQuery = 'FROM song s';
  const selectQuery = 'SELECT DISTINCT s.id';

  // Join with song_playlist and playlist tables if playlist filter is applied or if filtering by user's playlists
  if (playlist || onlyMyPlaylists || excludedPlaylists.length > 0) {
    baseQuery += ' JOIN song_playlist sp ON s.id = sp.song_id JOIN playlist p ON sp.playlist_id = p.id';
  }

  // Build the WHERE clause dynamically
  const whereConditions = [];
  const params: Array<string | number> = [];

  whereConditions.push('s.user_id = ?');
  params.push(userId);

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

  if (onlyMyPlaylists) {
    // Filter by owner_id based on active sessions
    if (spotifySession?.email || youtubeSession?.email) {
      const ownerIds = [];
      const ownerParams = [];

      if (spotifySession?.email) {
        ownerIds.push('p.owner_id = ?');
        ownerParams.push(spotifySession.email);
        const emailParts = spotifySession?.email.split('@');
        const usernameOnly = emailParts[0];
        ownerIds.push('p.owner_id = ?');
        ownerParams.push(usernameOnly);
      }

      if (youtubeSession?.email) {
        ownerIds.push('p.owner_id = ?');
        ownerParams.push(youtubeSession.email);
        const emailParts = youtubeSession?.email.split('@');
        const usernameOnly = emailParts[0];
        ownerIds.push('p.owner_id = ?');
        ownerParams.push(usernameOnly);
      }

      whereConditions.push(`(${ownerIds.join(' OR ')})`);
      params.push(...ownerParams);
    }
  }

  // Exclude songs that are only in excluded playlists
  if (excludedPlaylists.length > 0) {
    // This complex subquery ensures we only exclude songs that ONLY exist in excluded playlists
    // If a song is in both an excluded playlist and a non-excluded playlist, it will still be shown
    whereConditions.push(`
      NOT (
        s.id IN (
          SELECT DISTINCT sp1.song_id 
          FROM song_playlist sp1 
          JOIN playlist p1 ON sp1.playlist_id = p1.id 
          WHERE p1.name IN (${excludedPlaylists.map(() => '?').join(',')})
        )
        AND s.id NOT IN (
          SELECT DISTINCT sp2.song_id 
          FROM song_playlist sp2 
          JOIN playlist p2 ON sp2.playlist_id = p2.id 
          WHERE p2.name NOT IN (${excludedPlaylists.map(() => '?').join(',')})
        )
      )
    `);
    
    // Add the excluded playlist names twice (once for each subquery)
    params.push(...excludedPlaylists, ...excludedPlaylists);
  }

  if (songStatus) {
    if (songStatus === 'notDownloaded') {
      whereConditions.push('s.downloaded = 0');
    } else if (songStatus === 'localFiles') {
      whereConditions.push('s.local = 1');
    }
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  // Get all song IDs matching the filter criteria
  const songIds = await db.all(
    `${selectQuery} ${baseQuery} ${whereClause}`,
    params
  );

  // Return just the IDs as an array of strings
  return songIds.map((row: { id: number | string }) => row.id.toString());
}

/**
 * Get user by email address
 * @param email User email address
 * @returns User object or null if not found
 */
export async function getUserByEmail(email: string) {
  const db = await getDb();
  try {
    const user = await db.get(
      "SELECT * FROM user WHERE user_email = ?",
      [email]
    );
    return user || null;
  } catch (error) {
    console.error("Error getting user by email:", error);
    return null;
  } finally {
    await db.close();
  }
}