// Use ES modules
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function addTestUser() {
  // Open database connection
  const db = await open({
    filename: path.join(__dirname, '../app/db/songs.db'),
    driver: sqlite3.Database
  });

  console.log('Adding test user...');

  try {
    // Check if user already exists
    const existingUser = await db.get(
      'SELECT * FROM user WHERE user_email = ?',
      ['test@test.ch']
    );

    if (existingUser) {
      console.log('Test user already exists');
      return;
    }

    // Add test user
    await db.run(
      'INSERT INTO user (user_email, password) VALUES (?, ?)',
      [
        'test@test.ch',
        '$2b$10$/gdxc070n2vS8RGfyqwUsuQsQhG7SiTvtqr1ntlJLdkqVcGpy0yFy'
      ]
    );

    console.log('Test user added successfully');
  } catch (error) {
    console.error('Error adding test user:', error);
  } finally {
    await db.close();
  }
}

addTestUser().catch(console.error); 