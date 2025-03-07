import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import archiver from 'archiver';
import { Song } from '~/types/customs';
import { findMatchingFile } from '~/utils/file-matching.server';

/**
 * Creates a zip file containing all the songs
 * @param songs Array of songs to include in the zip
 * @param userId User ID for whom to create the zip
 * @param zipName Name of the zip file
 * @returns Path to the created zip file
 */
export async function createZipFromSongs(
  songs: Song[],
  userId: string,
  zipName: string = 'new-additions'
): Promise<string> {
  // Create a temporary directory for the zip file
  const tmpDir = path.join(process.cwd(), 'tmp', userId);
  await fs.mkdir(tmpDir, { recursive: true });
  
  const zipPath = path.join(tmpDir, `${zipName}.zip`);
  
  // Create a write stream for the zip file
  const output = createWriteStream(zipPath);
  const archive = archiver('zip', {
    zlib: { level: 5 } // Compression level (0-9)
  });
  
  // Pipe the archive to the file
  archive.pipe(output);
  
  // Keep track of files that were successfully added
  const addedFiles: string[] = [];
  const failedFiles: string[] = [];
  
  // Add each song to the archive
  for (const song of songs) {
    try {
      // Get the directory path for the song
      const playlistName = Array.isArray(song.playlist) && song.playlist.length > 0 
        ? song.playlist[0] 
        : 'default';
      
      const dirPath = path.join(process.cwd(), 'tmp', userId, playlistName);
      
      // Find the matching file
      const artistName = Array.isArray(song.artist_name) 
        ? song.artist_name.join(' ') 
        : typeof song.artist_name === 'string' 
          ? song.artist_name 
          : undefined;
      
      const downloadFile = await findMatchingFile(dirPath, song.title || '', artistName);
      
      if (downloadFile) {
        const filePath = path.join(dirPath, downloadFile);
        
        // Create a clean filename for the download that includes artist name
        let artistDisplay = '';
        if (Array.isArray(song.artist_name)) {
          // Clean up each artist name and join with commas
          artistDisplay = song.artist_name
            .map(artist => String(artist).replace(/[[\]_]/g, '').trim())
            .filter(Boolean)
            .join(', ');
        } else if (typeof song.artist_name === 'string') {
          // Clean up string representation if it looks like an array
          artistDisplay = String(song.artist_name)
            .replace(/[[\]_]/g, '')  // Remove brackets and underscores
            .replace(/,/g, ', ')     // Ensure spaces after commas
            .replace(/\s+/g, ' ')    // Normalize whitespace
            .trim();
        }
        
        // Create filename with format: "Artist1, Artist2, Artist3 - title.ext"
        const songTitle = (song.title || path.parse(downloadFile).name).trim();
        const fileExt = path.parse(downloadFile).ext || '.flac';
        const cleanFilename = artistDisplay 
          ? `${artistDisplay} - ${songTitle}${fileExt}`
          : `${songTitle}${fileExt}`;
        
        // Add the file to the archive with the clean filename
        archive.file(filePath, { name: cleanFilename });
        addedFiles.push(cleanFilename);
      } else {
        failedFiles.push(song.title || 'Unknown');
      }
    } catch (error) {
      console.error(`Error adding song to zip: ${song.title}`, error);
      failedFiles.push(song.title || 'Unknown');
    }
  }
  
  // Add a readme file with information about the zip
  const readmeContent = `
# New Additions Download

This zip file contains ${addedFiles.length} songs that were added to your library.
Created on: ${new Date().toLocaleString()}

## Successfully Added Files:
${addedFiles.map(file => `- ${file}`).join('\n')}

${failedFiles.length > 0 ? `
## Failed to Add:
${failedFiles.map(file => `- ${file}`).join('\n')}
` : ''}
`;
  
  archive.append(readmeContent, { name: 'README.txt' });
  
  // Finalize the archive
  await archive.finalize();
  
  // Return a promise that resolves when the archive is finished
  return new Promise((resolve, reject) => {
    output.on('close', () => {
      console.log(`Zip created successfully: ${zipPath} (${archive.pointer()} bytes)`);
      resolve(zipPath);
    });
    
    archive.on('error', (err) => {
      console.error('Error creating zip:', err);
      reject(err);
    });
  });
} 