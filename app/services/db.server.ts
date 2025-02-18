import sqlite3 from 'sqlite3';
import { open } from "sqlite";
import { spotifyStrategy } from "./auth.server";
import { getLikedSongsSpotify } from "./selfApi.server";

import path from "path";

// Initialize database connection
async function getDb() {
    return open({
        filename: path.join(process.cwd(), "app/db/songs.db"),
        driver: sqlite3.Database
    });
}

// Initialize tables if they don't exist
async function initDb() {
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
      platform_added_at TEXT,
      user TEXT,
      FOREIGN KEY(user) REFERENCES user(user)
    );
  `);

    return db;
}

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
    sortBy?: string;
    sortDirection?: 'asc' | 'desc';
  } = {}
) {
  const db = await getDb();
  const session = await spotifyStrategy.getSession(request);
  
  const {
    page = 1,
    itemsPerPage = 20,
    search = '',
    platform = '',
    playlist = '',
    sortBy = 'platform_added_at',
    sortDirection = 'desc'
  } = options;

  const offset = (page - 1) * itemsPerPage;

  // Build the WHERE clause dynamically
  const whereConditions = ['user = ?'];
  const params: any[] = [session?.user?.email];

  if (search) {
    whereConditions.push('(title LIKE ? OR artist_name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  if (platform) {
    whereConditions.push('platform = ?');
    params.push(platform);
  }

  if (playlist) {
    whereConditions.push('playlist = ?');
    params.push(playlist);
  }

  // Get total count for pagination
  const countResult = await db.get(
    `SELECT COUNT(*) as total FROM song WHERE ${whereConditions.join(' AND ')}`,
    params
  );

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
    total: countResult.total,
    currentPage: page,
    totalPages: Math.ceil(countResult.total / itemsPerPage)
  };
}



export async function populateSongsForUser(request: Request) {
    const session = await spotifyStrategy.getSession(request);
    if (!session) {
        throw new Error("No session established to spotify");
    }

    const db = await getDb();
    const likedsongs = await getLikedSongsSpotify(0, 50, session?.accessToken);
    console.log(session.user!.email)
    const latestRefresh = await getLatestRefresh(session.user!.email);

    const items = likedsongs?.items.filter(
        (t) => new Date(t.added_at) > new Date(latestRefresh)
    );

    if (items && items.length > 0) {
        try {
            // Begin transaction
            await db.run('BEGIN TRANSACTION');

            for (const item of items) {
                const artist_name = JSON.stringify(item.track.artists.map((t) => t.name));

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
                        session.user?.email,
                        "SpotifyLikedSongs",
                        "Spotify",
                        item.track.uri,
                        new Date(item.added_at).toISOString()
                    ]
                );
            }

            const currentDatetimeZ = new Date().toISOString().toLocaleString();
            await db.run(
                "INSERT OR REPLACE INTO user (user, last_refresh) VALUES (?, ?)",
                [session.user?.email, currentDatetimeZ]
            );

            // Commit transaction
            await db.run('COMMIT');

        } catch (error) {
            // Rollback on error
            await db.run('ROLLBACK');
            console.error(error);
            throw new Error("Error during inserting new songs");
        }
    }

 
    return true;
}