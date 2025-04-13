-- User table with improved structure
CREATE TABLE IF NOT EXISTS user (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT UNIQUE,
    password TEXT,
    user_spotify TEXT UNIQUE,
    user_youtube TEXT UNIQUE,
    last_refresh_spotify TEXT,
    last_refresh_youtube TEXT
);

-- Insert test user if it doesn't exist
INSERT OR IGNORE INTO user (user_email, password) 
VALUES ('test@test.ch', '$2b$10$/gdxc070n2vS8RGfyqwUsuQsQhG7SiTvtqr1ntlJLdkqVcGpy0yFy');

-- Song table (without playlist field)
CREATE TABLE IF NOT EXISTS song (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    artist_name TEXT,
    album TEXT,
    album_image TEXT,
    platform TEXT,
    url TEXT,
    downloaded BOOLEAN,
    local BOOLEAN DEFAULT 0,
    platform_added_at TEXT,
    user_id INTEGER,
    FOREIGN KEY(user_id) REFERENCES user(id)
);

-- Playlist table
CREATE TABLE IF NOT EXISTS playlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_playlist_id TEXT NOT NULL,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    owner_id TEXT,
    user_id INTEGER,
    UNIQUE(platform_playlist_id, platform),
    FOREIGN KEY(user_id) REFERENCES user(id)
);

-- Junction table for songs and playlists
CREATE TABLE IF NOT EXISTS song_playlist (
    song_id INTEGER,
    playlist_id INTEGER,
    added_at TEXT,
    PRIMARY KEY(song_id, playlist_id),
    FOREIGN KEY(song_id) REFERENCES song(id) ON DELETE CASCADE,
    FOREIGN KEY(playlist_id) REFERENCES playlist(id) ON DELETE CASCADE
);

-- User preferences table for storing file format preferences
CREATE TABLE IF NOT EXISTS user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    file_format TEXT NOT NULL DEFAULT 'flac',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES user(id) ON DELETE CASCADE,
    UNIQUE(user_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_song_user ON song(user_id);
CREATE INDEX IF NOT EXISTS idx_playlist_user ON playlist(user_id);
CREATE INDEX IF NOT EXISTS idx_song_playlist_song ON song_playlist(song_id);
CREATE INDEX IF NOT EXISTS idx_song_playlist_playlist ON song_playlist(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_platform ON playlist(platform);
CREATE INDEX IF NOT EXISTS idx_playlist_owner ON playlist(owner_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id); 