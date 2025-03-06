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

// Get user email from command line argument or use null to reset all users
const userEmail = process.argv[2];

// Create a new database connection
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to database:', err.message);
    process.exit(1);
  }
  console.log(`Connected to database at ${dbPath}`);
});

// Reset the last_refresh value
const resetQuery = userEmail 
  ? `UPDATE user SET last_refresh = '1970-01-01T00:00:00.000Z' WHERE user = ?`
  : `UPDATE user SET last_refresh = '1970-01-01T00:00:00.000Z'`;

const params = userEmail ? [userEmail] : [];

db.run(resetQuery, params, function(err) {
  if (err) {
    console.error('Error resetting last_refresh:', err.message);
    db.close();
    process.exit(1);
  }
  
  console.log(`Reset last_refresh for ${this.changes} user(s)`);
  
  // Close the database connection
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
      process.exit(1);
    }
    console.log('Database connection closed');
  });
}); 