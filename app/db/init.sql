-- User table
CREATE TABLE IF NOT EXISTS user (
    user TEXT PRIMARY KEY,
    last_refresh TEXT,
    last_refresh_spotify TEXT,
    last_refresh_youtube TEXT
);

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
    user TEXT,
    FOREIGN KEY(user) REFERENCES user(user)
);

-- Playlist table
CREATE TABLE IF NOT EXISTS playlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_playlist_id TEXT NOT NULL,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    owner_id TEXT,
    user TEXT,
    UNIQUE(platform_playlist_id, platform),
    FOREIGN KEY(user) REFERENCES user(user)
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

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_song_user ON song(user);
CREATE INDEX IF NOT EXISTS idx_playlist_user ON playlist(user);
CREATE INDEX IF NOT EXISTS idx_song_playlist_song ON song_playlist(song_id);
CREATE INDEX IF NOT EXISTS idx_song_playlist_playlist ON song_playlist(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_platform ON playlist(platform);
CREATE INDEX IF NOT EXISTS idx_playlist_owner ON playlist(owner_id); 