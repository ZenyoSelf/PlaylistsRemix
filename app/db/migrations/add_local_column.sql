-- Check if the local column already exists
PRAGMA table_info(song);

-- Add the local column if it doesn't exist
ALTER TABLE song ADD COLUMN local BOOLEAN DEFAULT 0;

-- Update existing records to set local=0 (files not locally available by default)
UPDATE song SET local = 0 WHERE local IS NULL;

-- Create a migrations table if it doesn't exist to track applied migrations
CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Record this migration
INSERT INTO migrations (name) VALUES ('add_local_column_to_song');

-- Commit the changes
PRAGMA foreign_keys = ON;