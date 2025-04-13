#!/usr/bin/env node

import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import process from 'process';

// Get the current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure the db directory exists
const dbDir = path.join(path.dirname(__dirname), 'app', 'db');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Path to the database file
const dbPath = path.join(dbDir, 'songs.db');

// Check if the database file already exists
if (fs.existsSync(dbPath)) {
  console.log(`Database file already exists at ${dbPath}`);
  console.log('If you want to recreate it, delete the file first.');
  process.exit(0);
}

// Create a new database
console.log(`Creating new database at ${dbPath}...`);
const db = new sqlite3.Database(dbPath);

// Run the initialization in a transaction
db.serialize(() => {
  db.run('BEGIN TRANSACTION;');

  // Create user table
  db.run(`
    CREATE TABLE IF NOT EXISTS user (
      user TEXT PRIMARY KEY,
      last_refresh TEXT
    );
  `);

  // Create song table with all the necessary columns
  db.run(`
    CREATE TABLE IF NOT EXISTS song (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      artist_name TEXT, -- Stores JSON array of artists
      album TEXT,
      album_image TEXT,
      playlist TEXT, -- Stores JSON array of playlists
      platform TEXT,
      url TEXT,
      downloaded BOOLEAN DEFAULT 0,
      local BOOLEAN DEFAULT 0,
      platform_added_at TEXT,
      user TEXT,
      FOREIGN KEY(user) REFERENCES user(user)
    );
  `);

  // Create migrations table to track schema changes
  db.run(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      applied_at TEXT
    );
  `);

  // Record our initial migrations as already applied
  db.run(`
    INSERT INTO migrations (name, applied_at) 
    VALUES 
      ('add_local_column_to_song', CURRENT_TIMESTAMP),
      ('modify_playlist_column', CURRENT_TIMESTAMP);
  `);

  db.run('COMMIT;', (err) => {
    if (err) {
      console.error('Error creating database:', err.message);
      process.exit(1);
    }
    console.log('Database initialized successfully!');
    db.close();
  });
}); 