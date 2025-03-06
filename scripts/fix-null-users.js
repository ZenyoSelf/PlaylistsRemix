#!/usr/bin/env node

import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import process from 'process';

// Get the current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the database file
const dbPath = path.join(path.dirname(__dirname), 'app', 'db', 'songs.db');

// Get user email from command line argument
const userEmail = process.argv[2];

if (!userEmail) {
  console.error('Please provide a user email as a command line argument');
  console.error('Usage: node fix-null-users.js your.email@example.com');
  process.exit(1);
}

// Create a new database connection
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to database:', err.message);
    process.exit(1);
  }
  console.log(`Connected to database at ${dbPath}`);
});

// First, check how many songs have null user field
db.get('SELECT COUNT(*) as count FROM song WHERE user IS NULL', [], (err, row) => {
  if (err) {
    console.error('Error counting songs with null user:', err.message);
    db.close();
    process.exit(1);
  }
  
  console.log(`Found ${row.count} songs with null user field`);
  
  if (row.count === 0) {
    console.log('No songs to fix');
    db.close();
    return;
  }
  
  // Update songs with null user field
  db.run('UPDATE song SET user = ? WHERE user IS NULL', [userEmail], function(err) {
    if (err) {
      console.error('Error updating songs:', err.message);
      db.close();
      process.exit(1);
    }
    
    console.log(`Updated ${this.changes} songs with user: ${userEmail}`);
    
    // Close the database connection
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err.message);
        process.exit(1);
      }
      console.log('Database connection closed');
    });
  });
}); 