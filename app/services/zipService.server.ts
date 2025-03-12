import fs from 'fs/promises';
import path from 'path';
import { createWriteStream, createReadStream } from 'fs';
import archiver from 'archiver';
import { Song } from '~/types/customs';
import { findMatchingFile } from '~/utils/file-matching.server';
import { emitProgress } from '~/workers/downloadWorker.server';

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
  
  // Create a write stream for the zip file with optimized buffer size
  const output = createWriteStream(zipPath, {
    highWaterMark: 1024 * 1024 // 1MB buffer for writing
  });
  
  // Create archiver with optimized settings
  const archive = archiver('zip', {
    zlib: { level: 5 }, // Compression level (0-9)
    highWaterMark: 1024 * 1024 // 1MB buffer for archiver
  });
  
  // Pipe the archive to the file
  archive.pipe(output);
  
  // Keep track of files that were successfully added
  const addedFiles: string[] = [];
  const failedFiles: string[] = [];
  
  // For bulk downloads, look in the bulk folder
  const bulkDir = path.join(process.cwd(), 'tmp', userId, 'bulk');
  const bulkDirExists = await fs.access(bulkDir).then(() => true).catch(() => false);
  
  // Track total files to be added for progress calculation
  const totalFiles = songs.length;
  let processedFiles = 0;
  
  // Set up progress tracking
  archive.on('progress', (progressData) => {
    // Calculate overall percentage based on entries processed vs total entries
    const { entries } = progressData;
    const entriesTotal = entries.total;
    const entriesProcessed = entries.processed;
    
    // Calculate percentage (0-100)
    const percentage = entriesTotal > 0 
      ? Math.round((entriesProcessed / entriesTotal) * 100) 
      : 0;
    
    // Log progress to console
    console.log(`Zip progress for ${zipName}: ${percentage}% (${entriesProcessed}/${entriesTotal} files)`);
    
    // Emit progress to client via SSE
    // Only emit on significant changes to avoid flooding the client
    if (percentage % 5 === 0 || percentage === 100) {
      emitProgress(userId, {
        type: 'progress',
        progress: percentage,
        jobId: zipName,
        songName: `Creating zip file: ${percentage}% (${entriesProcessed}/${entriesTotal} files)`,
        isBulk: zipName.startsWith('bulk-')
      });
    }
  });
  
  // Process each song and add to the archive using streams
  for (const song of songs) {
    try {
      // Get the directory path for the song
      let dirPath;
      
      // If this is a bulk download (zipName is a job ID starting with 'bulk-'), use the bulk folder
      if (zipName.startsWith('bulk-') && bulkDirExists) {
        dirPath = bulkDir;
      } else {
        // For regular downloads, use the playlist folder
        const playlistName = song.playlists && song.playlists.length > 0 
          ? song.playlists[0].name 
          : (Array.isArray(song.playlist) && song.playlist.length > 0 
            ? song.playlist[0] 
            : 'default');
        
        dirPath = path.join(process.cwd(), 'tmp', userId, playlistName);
      }
      
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
            .map(artist => String(artist)
              .replace(/[[\]_]/g, '')  // Remove brackets and underscores
              .replace(/"/g, '')       // Remove double quotes
              .replace(/'/g, '')       // Remove single quotes
              .trim())
            .filter(Boolean)
            .join(', ');
        } else if (typeof song.artist_name === 'string') {
          // Clean up string representation if it looks like an array
          artistDisplay = String(song.artist_name)
            .replace(/[[\]_]/g, '')    // Remove brackets and underscores
            .replace(/"/g, '')         // Remove double quotes
            .replace(/'/g, '')         // Remove single quotes
            .replace(/,/g, ', ')       // Ensure spaces after commas
            .replace(/\s+/g, ' ')      // Normalize whitespace
            .trim();
        }
        
        // Create filename with format: "Artist1, Artist2, Artist3 - title.ext"
        const songTitle = (song.title || path.parse(downloadFile).name).trim();
        const fileExt = path.parse(downloadFile).ext || '.flac';
        const cleanFilename = artistDisplay 
          ? `${artistDisplay} - ${songTitle}${fileExt}`
          : `${songTitle}${fileExt}`;
        
        try {
          // Create a read stream for the file with optimized buffer size
          const fileStream = createReadStream(filePath, {
            highWaterMark: 4 * 1024 * 1024 // 4MB chunks for reading
          });
          
          // Add the file to the archive using streaming
          archive.append(fileStream, { name: cleanFilename });
          addedFiles.push(cleanFilename);
          
          // Handle file stream errors
          fileStream.on('error', (err) => {
            console.error(`Error reading file ${filePath}:`, err);
            failedFiles.push(cleanFilename);
          });
          
          // Track when the file has been fully processed
          fileStream.on('end', () => {
            console.log(`File processed: ${cleanFilename}`);
          });
        } catch (fileError) {
          console.error(`Error creating stream for ${filePath}:`, fileError);
          failedFiles.push(cleanFilename);
        }
      } else {
        failedFiles.push(song.title || 'Unknown');
      }
      
      // Update processed files count
      processedFiles++;
      
      // Emit progress for file processing (separate from archiver's internal progress)
      if (processedFiles % 5 === 0 || processedFiles === totalFiles) {
        const fileProcessPercentage = Math.round((processedFiles / totalFiles) * 100);
        console.log(`File processing progress: ${fileProcessPercentage}% (${processedFiles}/${totalFiles})`);
        
        // Only emit on significant changes to avoid flooding
        emitProgress(userId, {
          type: 'progress',
          progress: fileProcessPercentage,
          jobId: zipName,
          songName: `Preparing files for zip: ${fileProcessPercentage}% (${processedFiles}/${totalFiles})`,
          isBulk: zipName.startsWith('bulk-')
        });
      }
    } catch (error) {
      console.error(`Error adding song to zip: ${song.title}`, error);
      failedFiles.push(song.title || 'Unknown');
      
      // Update processed files count even for failed files
      processedFiles++;
    }
  }
  
  // Log summary before finalizing
  console.log(`Zip summary for ${zipName}: ${addedFiles.length} files added, ${failedFiles.length} files failed`);
  
  // Emit progress update before finalizing
  emitProgress(userId, {
    type: 'progress',
    progress: 90,
    jobId: zipName,
    songName: `Finalizing zip file with ${addedFiles.length} songs (${failedFiles.length} failed)`,
    isBulk: zipName.startsWith('bulk-')
  });

  try {
    // Finalize the archive
    await archive.finalize();
    
    // Return a promise that resolves when the archive is finished
    return new Promise((resolve, reject) => {
      output.on('close', () => {
        const finalSize = archive.pointer();
        const sizeInMB = (finalSize / (1024 * 1024)).toFixed(2);
        console.log(`Zip created successfully: ${zipPath} (${sizeInMB} MB)`);
        
        // Emit final completion message
        emitProgress(userId, {
          type: 'progress',
          progress: 100,
          jobId: zipName,
          songName: `Zip file created: ${addedFiles.length} songs, ${sizeInMB} MB`,
          isBulk: zipName.startsWith('bulk-')
        });
        
        resolve(zipPath);
      });
      
      archive.on('error', (err) => {
        console.error('Error creating zip:', err);
        
        // Emit error message
        emitProgress(userId, {
          type: 'error',
          jobId: zipName,
          songName: `Error creating zip file: ${err.message}`,
          error: err.message,
          isBulk: zipName.startsWith('bulk-')
        });
        
        reject(err);
      });
      
      // Handle warnings
      archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
          // Log warning but don't fail
          console.warn(`Warning during zip creation: ${err.message}`);
        } else {
          // For other warnings, emit error
          console.error('Error during zip creation:', err);
          emitProgress(userId, {
            type: 'error',
            jobId: zipName,
            songName: `Warning during zip creation: ${err.message}`,
            error: err.message,
            isBulk: zipName.startsWith('bulk-')
          });
        }
      });
    });
  } catch (error) {
    console.error('Error finalizing archive:', error);
    
    // Emit error message
    emitProgress(userId, {
      type: 'error',
      jobId: zipName,
      songName: `Error finalizing zip file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error: error instanceof Error ? error.message : 'Unknown error',
      isBulk: zipName.startsWith('bulk-')
    });
    
    throw error;
  }
} 