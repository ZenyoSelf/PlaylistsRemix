// Use ES modules
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exit } from 'process';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function backupDatabase() {
  const dbPath = path.join(__dirname, '../app/db/songs.db');
  
  // Check if database exists
  if (!fs.existsSync(dbPath)) {
    console.log('No database found to backup');
    return;
  }
  
  // Create backups directory if it doesn't exist
  const backupsDir = path.join(__dirname, '../app/db/backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
    console.log('Created backups directory');
  }
  
  // Create backup with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupsDir, `songs_${timestamp}.db`);
  
  // Copy database file
  fs.copyFileSync(dbPath, backupPath);
  console.log(`Database backed up to ${backupPath}`);
}

async function runMigrations() {
  // Backup database before migrations
  try {
    await backupDatabase();
  } catch (error) {
    console.error('Error backing up database:', error);
    console.log('Continuing with migrations...');
  }

  // Open database connection
  const db = await open({
    filename: path.join(__dirname, '../app/db/songs.db'),
    driver: sqlite3.Database
  });

  console.log('Running migrations...');

  try {
    // Get all migration files
    const migrationsDir = path.join(__dirname, '../app/db/migrations');
    
    // Create migrations directory if it doesn't exist
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
      console.log('Created migrations directory');
    }
    
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    // Create migrations table if it doesn't exist
    await db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Run each migration if not already applied
    for (const file of migrationFiles) {
      const migrationName = file;
      
      // Check if migration has already been applied
      const migrationRecord = await db.get(
        'SELECT * FROM migrations WHERE name = ?',
        [migrationName]
      );
      
      if (!migrationRecord) {
        console.log(`Applying migration: ${migrationName}`);
        
        // Read migration file
        const migrationSql = fs.readFileSync(
          path.join(migrationsDir, file),
          'utf8'
        );
        
        // Begin transaction
        await db.exec('BEGIN TRANSACTION');
        
        try {
          // Execute migration
          await db.exec(migrationSql);
          
          // Record that migration has been applied
          await db.run(
            'INSERT INTO migrations (name) VALUES (?)',
            [migrationName]
          );
          
          // Commit transaction
          await db.exec('COMMIT');
          
          console.log(`Migration applied: ${migrationName}`);
        } catch (error) {
          // Rollback transaction on error
          await db.exec('ROLLBACK');
          console.error(`Error applying migration ${migrationName}:`, error);
          throw error;
        }
      } else {
        console.log(`Migration already applied: ${migrationName}`);
      }
    }
    
    console.log('All migrations completed successfully');
  } catch (error) {
    console.error('Error running migrations:', error);
    exit(1);
  } finally {
    await db.close();
  }
}

runMigrations().catch(console.error); 