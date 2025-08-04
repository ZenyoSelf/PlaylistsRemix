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

// Path to the database file and init.sql
const dbPath = path.join(dbDir, 'songs.db');
const initSqlPath = path.join(dbDir, 'init.sql');

// Check if the database file already exists
if (fs.existsSync(dbPath)) {
  console.log(`Database file already exists at ${dbPath}`);
  console.log('If you want to recreate it, delete the file first.');
  process.exit(0);
}

// Check if init.sql exists
if (!fs.existsSync(initSqlPath)) {
  console.error(`init.sql file not found at ${initSqlPath}`);
  process.exit(1);
}

// Read the init.sql file
const initSql = fs.readFileSync(initSqlPath, 'utf8');

// Create a new database
console.log(`Creating new database at ${dbPath}...`);
const db = new sqlite3.Database(dbPath);

// Run the initialization in a transaction
db.serialize(() => {
  db.run('BEGIN TRANSACTION;');

  // Execute the init.sql content
  db.exec(initSql, (err) => {
    if (err) {
      console.error('Error executing init.sql:', err.message);
      db.run('ROLLBACK;');
      process.exit(1);
    }
    
    // Create migrations table to track schema changes (in serialize callback)
    db.run(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        applied_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `, (err) => {
      if (err) {
        console.error('Error creating migrations table:', err.message);
        db.run('ROLLBACK;');
        process.exit(1);
      }

      // Record that we've initialized the database with init.sql
      db.run(`
        INSERT INTO migrations (name, applied_at) 
        VALUES ('initial_schema_from_init_sql', CURRENT_TIMESTAMP);
      `, (err) => {
        if (err) {
          console.error('Error inserting migration record:', err.message);
          db.run('ROLLBACK;');
          process.exit(1);
        }

        db.run('COMMIT;', (err) => {
          if (err) {
            console.error('Error committing transaction:', err.message);
            process.exit(1);
          }
          console.log('Database initialized successfully using init.sql!');
          db.close();
        });
      });
    });
  });
});