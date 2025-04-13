import path from 'path';
import fs from 'fs/promises';
import { getDb, updateSongLocalStatus } from '~/services/db.server';

// Number of days to keep files before cleanup
const FILE_RETENTION_DAYS = 2;

// Function to clean up old files
export async function cleanupOldFiles() {
  try {
    console.log('Starting file cleanup job...');
    
    // Get the base temp directory
    const tmpDir = path.join(process.cwd(), 'tmp');
    
    // Check if the directory exists
    try {
      await fs.access(tmpDir);
    } catch (error) {
      console.log('Temp directory does not exist, nothing to clean up');
      return;
    }
    
    // Get all user directories
    const userDirs = await fs.readdir(tmpDir);
    
    // Get current date for comparison
    const now = new Date();
    const cutoffDate = new Date(now.setDate(now.getDate() - FILE_RETENTION_DAYS));
    
    // Get database connection
    const db = await getDb();
    
    // Process each user directory
    for (const userId of userDirs) {
      const userDir = path.join(tmpDir, userId);
      
      // Check if it's a directory
      const stats = await fs.stat(userDir);
      if (!stats.isDirectory()) continue;
      
      // Get all playlist directories for this user
      const playlistDirs = await fs.readdir(userDir);
      
      for (const playlist of playlistDirs) {
        const playlistDir = path.join(userDir, playlist);
        
        // Check if it's a directory
        const playlistStats = await fs.stat(playlistDir);
        if (!playlistStats.isDirectory()) continue;
        
        // Get all files in this playlist directory
        const files = await fs.readdir(playlistDir);
        
        for (const file of files) {
          const filePath = path.join(playlistDir, file);
          
          // Get file stats
          const fileStats = await fs.stat(filePath);
          
          // Check if the file is older than the cutoff date
          if (fileStats.mtime < cutoffDate) {
            try {
              // Find the song in the database
              const songTitle = path.parse(file).name.split(' - ')[1] || path.parse(file).name;
              
              // Get songs that match this title and are in the specified playlist
              const songs = await db.all(
                `SELECT s.id 
                 FROM song s
                 JOIN song_playlist sp ON s.id = sp.song_id
                 JOIN playlist p ON sp.playlist_id = p.id
                 WHERE s.title LIKE ? AND s.user = ? AND p.name = ?`,
                [`%${songTitle}%`, userId, playlist]
              );
              
              // Delete the file
              await fs.unlink(filePath);
              console.log(`Deleted old file: ${filePath}`);
              
              // Update song status in database
              for (const song of songs) {
                await updateSongLocalStatus(song.id.toString(), false);
                console.log(`Updated song ${song.id} local status to false`);
              }
            } catch (error) {
              console.error(`Error deleting file ${filePath}:`, error);
            }
          }
        }
      }
    }
    
    console.log('File cleanup job completed');
  } catch (error) {
    console.error('Error in cleanup job:', error);
  }
} 