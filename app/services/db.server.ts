import sqlite3 from 'sqlite3';
import { open } from "sqlite";
import { spotifyStrategy } from "./auth.server";
import { getLikedSongsSpotify } from "./selfApi.server";
import { Song } from "~/types/customs";
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

export async function getUserSongsFromDB(request: Request,itemsNumber:number): Promise<Song[]> {
    const session = await spotifyStrategy.getSession(request);
    if (!session) {
        throw new Error("No session established to spotify");
    }

    const db = await getDb();
    try {

        const songs = await db.all(
            "SELECT * FROM song WHERE user = ? ORDER BY platform_added_at DESC LIMIT ?",
            session.user!.email,
            itemsNumber
        );

        return songs.map((item) => ({
            id: item.id,
            title: item.title,
            artists: JSON.parse(item.artist_name), // Store as JSON string in SQLite
            album: item.album,
            playlist: item.playlist,
            platform: item.platform,
            url: item.url,
            downloaded: Boolean(item.downloaded), // SQLite stores as 0/1
            platform_added_at: item.platform_added_at,
        }));
    } catch (error) {
        console.error("Error fetching songs from SQLite:", error);
        return [];
    }
}



export async function populateSongsForUser(request: Request) {
    const session = await spotifyStrategy.getSession(request);
    if (!session) {
        throw new Error("No session established to spotify");
    }

    const db = await getDb();
    const likedsongs = await getLikedSongsSpotify(0, 20, session?.accessToken);
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
          (artist_name, downloaded, title, album, user, playlist, platform, url, platform_added_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        artist_name,
                        0, // false for downloaded
                        item.track.name,
                        item.track.album.name,
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