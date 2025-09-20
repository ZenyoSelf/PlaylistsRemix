import fs from 'fs/promises';
import path from 'path';
import { createWriteStream, createReadStream } from 'fs';
import archiver from 'archiver';
import { Song } from '~/types/customs';
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

  // Track which songs were included in the zip by ID
  const includedSongIds: number[] = [];

  // For bulk downloads, look in the bulk folder
  const bulkDir = path.join(process.cwd(), 'tmp', userId, 'bulk');
  const bulkDirExists = await fs.access(bulkDir).then(() => true).catch(() => false);

  // Initialize counters for progress tracking
  let processedSongs = 0;
  const totalSongs = songs.length;

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

      console.log(`Looking for file matching song: "${song.title}" by "${artistName}" in ${dirPath}`);

      // Add a retry mechanism for finding the file
      let downloadFile = null;
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries && !downloadFile) {
        try {

          // If that fails, try a more aggressive approach for bulk folder files

          console.log(`Standard matching failed, trying bulk folder specific matching for "${song.title}"`);

          // Get all files in the directory
          const allFiles = await fs.readdir(dirPath);
          console.log(`All files in bulk folder: ${JSON.stringify(allFiles)}`);

          // Use standard file matching without NA prefix
          console.log(`Looking for files matching song: "${song.title}"`);

          // Try to match by title keywords using all files
          const titleKeywords = (song.title || '').toLowerCase().split(' ')
            .filter(word => word.length > 3)  // Only use meaningful keywords
            .map(word => word.replace(/[^\w]/g, '')); // Remove special characters

          console.log(`Title keywords for "${song.title}": ${JSON.stringify(titleKeywords)}`);

          if (titleKeywords.length > 0) {
            // Find the file with the most keyword matches
            const matches = allFiles.map(file => {
              const fileName = file.toLowerCase();
              const matchCount = titleKeywords.filter(keyword => fileName.includes(keyword)).length;
              const matchRatio = matchCount / titleKeywords.length;
              return { file, matchCount, matchRatio };
            })
              .filter(match => match.matchRatio > 0.3) // At least 30% of keywords match
              .sort((a, b) => b.matchRatio - a.matchRatio); // Sort by match ratio descending

            if (matches.length > 0) {
              console.log(`Found bulk file match: "${matches[0].file}" with match ratio ${matches[0].matchRatio}`);
              downloadFile = matches[0].file;
            }
          }

          // If keyword matching failed, try artist name matching as a fallback
          if (!downloadFile && artistName) {
            const artistKeywords = artistName.toLowerCase().split(' ')
              .filter(word => word.length > 2)
              .map(word => word.replace(/[^\w]/g, ''));

            if (artistKeywords.length > 0) {
              const artistMatches = allFiles.filter(file => {
                const fileName = file.toLowerCase();
                return artistKeywords.some(keyword => fileName.includes(keyword));
              });

              if (artistMatches.length > 0) {
                console.log(`Found artist match in bulk folder: "${artistMatches[0]}"`);
                downloadFile = artistMatches[0];
              }
            }
          }

          // Last resort: if we have a single file left that hasn't been matched to any song yet,
          // and we're on the last song, just use that file
          if (!downloadFile && processedSongs === totalSongs - 1) {
            // Get list of files that have already been added to the zip
            const remainingFiles = allFiles.filter(file =>
              !addedFiles.includes(file) &&
              !failedFiles.includes(file)
            );

            if (remainingFiles.length === 1) {
              console.log(`Last resort match - using last remaining file: "${remainingFiles[0]}"`);
              downloadFile = remainingFiles[0];
            }
          }


          if (downloadFile) break;

          console.log(`File not found on attempt ${retryCount + 1}/${maxRetries}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 500));
          retryCount++;
        } catch (error) {
          console.error(`Error finding file on attempt ${retryCount + 1}/${maxRetries}:`, error);
          retryCount++;
          if (retryCount >= maxRetries) throw error;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      if (downloadFile) {
        const filePath = path.join(dirPath, downloadFile);
        console.log(`Found matching file: ${filePath}`);

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

        // Use clean filename format consistently
        const cleanFilename = artistDisplay
          ? `${artistDisplay} - ${songTitle}${fileExt}`
          : `${songTitle}${fileExt}`;

        console.log(`Adding to zip with filename: ${cleanFilename}`);

        try {
          // Create a read stream for the file
          const fileStream = createReadStream(filePath);

          // Add the file to the archive with the clean filename
          archive.append(fileStream, { name: cleanFilename });

          // Track the file as successfully added
          addedFiles.push(downloadFile);

          // Track the song ID as included in the zip
          includedSongIds.push(song.id);

          // Update progress
          processedSongs++;
          const progress = Math.round((processedSongs / totalSongs) * 100);

          // Emit progress event
          emitProgress(userId, {
            type: 'progress',
            progress,
            jobId: zipName,
            songName: `Zipping ${processedSongs}/${totalSongs}: ${songTitle}`,
            isBulk: zipName.startsWith('bulk-')
          });

          console.log(`Added file to zip (${processedSongs}/${totalSongs}): ${cleanFilename}`);
        } catch (error) {
          console.error(`Error adding file to zip: ${filePath}`, error);
          failedFiles.push(downloadFile);
          // Continue with other files even if one fails
        }
      } else {
        console.warn(`Could not find file for song: "${song.title}" by "${artistName}" in ${dirPath}`);
        failedFiles.push(song.title || 'Unknown');
        // Continue with other songs even if one is missing
      }
    } catch (error) {
      console.error(`Error processing song for zip: ${song.title}`, error);
      // Continue with other songs even if one fails
    }
  }

  // Log summary before finalizing
  console.log(`Zip summary for ${zipName}: ${addedFiles.length} files added, ${failedFiles.length} files failed`);
  console.log(`Included song IDs: ${includedSongIds.join(', ')}`);

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

        // Store the included song IDs in a metadata file
        const metadataPath = path.join(tmpDir, `${zipName}.meta.json`);
        fs.writeFile(metadataPath, JSON.stringify({
          includedSongIds,
          addedFiles,
          failedFiles,
          timestamp: new Date().toISOString()
        }))
          .then(() => {
            console.log(`Metadata saved to ${metadataPath}`);
            resolve(zipPath);
          })
          .catch(err => {
            console.error(`Error saving metadata: ${err.message}`);
            // Still resolve with the zip path even if metadata saving fails
            resolve(zipPath);
          });
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

/**
 * Creates a zip file from a list of file paths
 * @param filePaths Array of file paths to include in the zip
 * @param outputZipPath Full path where the zip file should be created
 * @returns Path to the created zip file
 */
export async function createZipFromFilePaths(
  filePaths: string[],
  outputZipPath: string
): Promise<string> {
  // Create the directory for the zip file if it doesn't exist
  const outputDir = path.dirname(outputZipPath);
  await fs.mkdir(outputDir, { recursive: true });

  // Create a write stream for the zip file with optimized buffer size
  const output = createWriteStream(outputZipPath, {
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

  // Process each file and add to the archive using streams
  for (const filePath of filePaths) {
    try {
      // Check if the path exists and is a file (not a directory)
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) {
        console.log(`Skipping directory: ${path.basename(filePath)}`);
        continue;
      }

      // Get the filename from the path
      const fileName = path.basename(filePath);

      console.log(`Adding to zip: ${fileName}`);

      // Create a read stream for the file
      const fileStream = createReadStream(filePath);

      // Add the file to the archive
      archive.append(fileStream, { name: fileName });

      // Track the file as successfully added
      addedFiles.push(fileName);
    } catch (error) {
      console.error(`Error adding file to zip: ${filePath}`, error);
      failedFiles.push(filePath);
      // Continue with other files even if one fails
    }
  }

  // Log summary before finalizing
  console.log(`Zip summary: ${addedFiles.length} files added, ${failedFiles.length} files failed`);

  try {
    // Finalize the archive
    await archive.finalize();

    // Return a promise that resolves when the archive is finished
    return new Promise((resolve, reject) => {
      output.on('close', () => {
        const finalSize = archive.pointer();
        const sizeInMB = (finalSize / (1024 * 1024)).toFixed(2);
        console.log(`Zip created successfully: ${outputZipPath} (${sizeInMB} MB)`);
        resolve(outputZipPath);
      });

      archive.on('error', (err) => {
        console.error('Error creating zip:', err);
        reject(err);
      });

      // Handle warnings
      archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
          // Log warning but don't fail
          console.warn(`Warning during zip creation: ${err.message}`);
        } else {
          // For other warnings, log error
          console.error('Error during zip creation:', err);
        }
      });
    });
  } catch (error) {
    console.error('Error finalizing archive:', error);
    throw error;
  }
} 