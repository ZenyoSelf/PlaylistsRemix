-- Migration to modify the playlist column to store JSON arrays
-- SQLite doesn't have a native array type, so we'll use TEXT to store JSON arrays

-- First, check if the migrations table exists
CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TEXT
);

-- Check if this migration has already been applied
INSERT OR IGNORE INTO migrations (name, applied_at) 
VALUES ('modify_playlist_column', CURRENT_TIMESTAMP);

-- Create a temporary table with the new schema
CREATE TABLE IF NOT EXISTS song_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  artist_name TEXT,
  album TEXT,
  album_image TEXT,
  playlist TEXT, -- This will store JSON arrays as text
  platform TEXT,
  url TEXT,
  downloaded BOOLEAN,
  local BOOLEAN DEFAULT 0,
  platform_added_at TEXT,
  user TEXT,
  FOREIGN KEY(user) REFERENCES user(user)
);

-- Copy data from the old table to the new one, converting playlist to JSON array if needed
INSERT INTO song_new 
SELECT 
  id, 
  title, 
  artist_name, 
  album, 
  album_image, 
  CASE 
    WHEN playlist IS NULL THEN '[]'
    WHEN playlist LIKE '[%]' THEN playlist -- Already JSON array
    ELSE json_array(playlist) -- Convert single value to JSON array
  END as playlist, 
  platform, 
  url, 
  downloaded, 
  local, 
  platform_added_at, 
  user
FROM song;

-- Drop the old table
DROP TABLE song;

-- Rename the new table to the original name
ALTER TABLE song_new RENAME TO song; 