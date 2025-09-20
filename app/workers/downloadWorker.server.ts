import { downloadQueue } from '~/services/queue.server';
import path from 'path';
import { downloadSpotifySong } from '~/services/selfApi.server';
import { getSongById, getSongsByIds, updateSongDownloadStatus, updateSongLocalStatus } from '~/services/db.server';
import { createZipFromFilePaths } from '~/services/zipService.server';
import fs from 'fs/promises';
import { Job } from 'bull';
import { execFile } from 'child_process';
import { getUserPreferredFormat } from '~/services/userPreferences.server';
import { fileURLToPath } from 'url';
import { convertSpotifyToYouTubeMusic } from '~/services/spotToYt.server';
import { sanitizeDirectoryName } from '~/utils/file-utils';

// Construct __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ytDlpPath = path.resolve(__dirname, "../utils/yt-dlp");
const ffmpegPath = path.resolve(__dirname, "../utils/ffmpeg");

/**
 * Convert FLAC file to AIFF using ffmpeg while preserving metadata
 */
async function convertFlacToAiff(flacFilePath: string): Promise<string> {
  const aiffFilePath = flacFilePath.replace(/\.flac$/i, '.aiff');
  
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath,
      [
        '-i', flacFilePath,
        '-c:a', 'pcm_s16be', // Use PCM 16-bit big-endian for AIFF
        '-write_id3v2', '1', // Enable ID3v2 metadata writing for AIFF
        '-map_metadata', '0', // Copy all metadata
        '-map', '0:a', // Map audio stream
        '-map', '0:v?', // Map video/cover art if present (optional)
        '-y', // Overwrite output file if it exists
        aiffFilePath
      ],
      (error, stdout, stderr) => {
        if (error) {
          console.error(`ffmpeg conversion error: ${error.message}`);
          console.error(`ffmpeg stderr: ${stderr}`);
          reject(error);
        } else {
          console.log(`Successfully converted ${flacFilePath} to ${aiffFilePath}`);
          console.log(`ffmpeg stdout: ${stdout}`);
          console.log(`Metadata and album art should be preserved in AIFF file`);
          // Clean up the original FLAC file
          fs.unlink(flacFilePath).catch(err => 
            console.warn(`Could not delete original FLAC file: ${err.message}`)
          );
          resolve(aiffFilePath);
        }
      }
    );
  });
}

// Define the job data interface
interface DownloadJobData {
  songId?: string;
  userId: string;
  type?: 'single' | 'bulk';
  bulkSongIds?: string[];
  songName?: string;
  zipPath?: string;
  successCount?: number;
  failCount?: number;
  sanitizedPlaylistName?: string;
  originalPlaylistName?: string;
}

// Map to store event sources for each user
const eventSources = new Map<string, Set<(data: ProgressData) => void>>();

interface ProgressData {
  type: 'progress' | 'complete' | 'error' | 'queued' | 'usercancelled' | 'info';
  progress?: number;
  jobId: string | number;
  songName: string;
  filePath?: string;
  error?: string;
  isBulk?: boolean;
}

// Store active download streams
const downloadStreams = new Map<string, ReadableStreamController<Uint8Array>>();

export function registerDownloadStream(userId: string, controller: ReadableStreamController<Uint8Array>) {
  downloadStreams.set(userId, controller);
}

export function removeDownloadStream(userId: string) {
  downloadStreams.delete(userId);
}

// Emit progress to all connected clients for a user
export function emitProgress(userId: string, data: ProgressData) {
  const userEventSources = eventSources.get(userId);
  if (userEventSources) {
    for (const callback of userEventSources) {
      callback(data);
    }
  }
  
  // Also send to any active download streams
  const controller = downloadStreams.get(userId);
  if (controller) {
    try {
      const eventData = `event: message\ndata: ${JSON.stringify(data)}\n\n`;
      controller.enqueue(new TextEncoder().encode(eventData));
    } catch (error) {
      console.error(`Error sending progress to stream for user ${userId}:`, error);
    }
  }
}

// Add a new event source for a user
export function addEventSource(userId: string, callback: (data: ProgressData) => void) {
  if (!eventSources.has(userId)) {
    eventSources.set(userId, new Set());
  }
  eventSources.get(userId)?.add(callback);
}

// Remove an event source for a user
export function removeEventSource(userId: string, callback: (data: ProgressData) => void) {
  const userEventSources = eventSources.get(userId);
  if (userEventSources) {
    userEventSources.delete(callback);
    if (userEventSources.size === 0) {
      eventSources.delete(userId);
    }
  }
}

// Process download jobs
downloadQueue.process(async (job) => {
  // Check if this is a bulk download job
  if (job.data.type === 'bulk' && job.data.bulkSongIds) {
    return processBulkDownload(job);
  } else {
    return processSingleDownload(job);
  }
});

// Process a single song download
async function processSingleDownload(job: Job<DownloadJobData>) {
  const { songId = '', userId, sanitizedPlaylistName } = job.data;
  const song = await getSongById(songId);
  try {
    // Get song details from your database
    if (!song) {
      throw new Error(`Song not found: ${songId}`);
    }

    // Start download with job info
    emitProgress(userId, {
      type: 'progress',
      progress: 0,
      jobId: job.id,
      songName: song.title || 'Unknown Song'
    });

    // Ensure artist_name is an array
    let artists: string[] = [];
    if (Array.isArray(song.artist_name)) {
      artists = song.artist_name;
    } else if (typeof song.artist_name === 'string') {
      const artistString = song.artist_name as string;
      artists = artistString.split(',').map((a: string) => a.trim()).filter(Boolean);
    }

    // Get playlist name - use the sanitized name if provided, otherwise sanitize it here
    let playlistName;
    if (sanitizedPlaylistName) {
      playlistName = sanitizedPlaylistName;
    } else {
      const rawPlaylistName = song.playlists && song.playlists.length > 0 
        ? song.playlists[0].name 
        : (Array.isArray(song.playlist) && song.playlist.length > 0 
          ? song.playlist[0] 
          : 'default');
      playlistName = sanitizeDirectoryName(rawPlaylistName);
    }

    // Download the song
    await downloadSpotifySong(song.title || 'Unknown', artists, playlistName, userId);

    // Update song status in database
    await updateSongDownloadStatus(songId, true);
    await updateSongLocalStatus(songId, true);

    // Update progress to 100% with job info
    emitProgress(userId, {
      type: 'progress',
      progress: 100,
      jobId: job.id,
      songName: song.title || 'Unknown Song'
    });

    // Emit completion with job info
    emitProgress(userId, {
      type: 'complete',
      jobId: job.id,
      songName: song.title || 'Unknown Song',
      filePath: songId
    });

    return {
      status: 'completed',
      songId,
      userId
    };
  } catch (error) {
    console.error(`Error downloading song ${songId}:`, error);

    // Update song status in database to mark as not downloaded
    try {
      await updateSongDownloadStatus(songId, false);
      await updateSongLocalStatus(songId, false);
    } catch (dbError) {
      console.error(`Error updating song status in database:`, dbError);
    }

    // Emit error with job info
    emitProgress(userId, {
      type: 'error',
      jobId: job.id,
      songName: song?.title || 'Unknown Song',
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    throw error;
  }
}

// Process a bulk download job
async function processBulkDownload(job: Job<DownloadJobData>) {
  const { userId, bulkSongIds = [] } = job.data;
  
  // Create a sanitized bulk folder name
  const bulkFolderName = sanitizeDirectoryName('bulk');
  
  // Create the output directory for bulk downloads
  const outputDir = path.join(process.cwd(), "tmp", userId, bulkFolderName);
  try {
    await fs.mkdir(outputDir, { recursive: true });
    console.log(`Created bulk output directory: ${outputDir}`);
  } catch (error) {
    console.error(`Error creating bulk output directory: ${outputDir}`, error);
    throw error;
  }
  
  try {
    // Clean up any existing debug files
    try {
      const existingFiles = await fs.readdir(outputDir);
      for (const file of existingFiles) {
        if (file.includes('debug-') || file.endsWith('.bat')) {
          await fs.unlink(path.join(outputDir, file)).catch(() => {});
        }
      }
    } catch (e) {
      // Ignore errors during cleanup
    }
    
    // Get all songs from the database
    const songs = await getSongsByIds(bulkSongIds);
    const totalSongs = songs.length;
    
    if (totalSongs === 0) {
      throw new Error("No songs found for bulk download");
    }
    
    // Emit initial progress
    emitProgress(userId, {
      type: 'progress',
      progress: 0,
      jobId: job.id,
      songName: `Bulk download (${totalSongs} songs)`,
      isBulk: true
    });

    // Process URLs and create a batch file
    const batchFile = path.join(outputDir, 'urls.txt');
    const processedUrls: string[] = [];
    
    // For tracking conversion progress
    let convertedCount = 0;
    const spotifyTracks = songs.filter(song => song.platform === 'Spotify');
    const hasSpotifyTracks = spotifyTracks.length > 0;
    
    // Initial progress update for conversion if needed
    if (hasSpotifyTracks) {
      // Send a clear initial status update
      console.log(`Starting conversion of ${spotifyTracks.length} Spotify tracks to YouTube Music URLs`);
      emitProgress(userId, {
        type: 'progress',
        progress: 0,
        jobId: job.id,
        songName: `Converting Spotify URLs (0/${spotifyTracks.length})`,
        isBulk: true
      });
      
      // Also send an info message to make it clear what's happening
      emitProgress(userId, {
        type: 'info',
        jobId: job.id,
        songName: `Starting conversion of ${spotifyTracks.length} Spotify tracks`,
        isBulk: true
      });
    }
    
    for (const song of songs) {
      try {
        let url = song.url;
        
        // If it's a Spotify track, convert it to YouTube Music URL
        if (song.platform === 'Spotify') {
          const artists = Array.isArray(song.artist_name) 
            ? song.artist_name 
            : typeof song.artist_name === 'string' 
              ? song.artist_name.split(',').map((a: string) => a.trim())
              : [];
              
          // Update conversion progress
          emitProgress(userId, {
            type: 'progress',
            progress: Math.round((convertedCount / spotifyTracks.length) * 100),
            jobId: job.id,
            songName: `Converting Spotify URLs (${convertedCount}/${spotifyTracks.length})`,
            isBulk: true
          });
          
          // Send info about current conversion
          emitProgress(userId, {
            type: 'info',
            jobId: job.id,
            songName: `Converting: "${song.title}" by ${artists.join(', ')}`,
            isBulk: true
          });
          
          url = await convertSpotifyToYouTubeMusic(song.title, artists);
          console.log(`Converted Spotify URL to YouTube Music: ${url}`);
          
          // Increment counter
          convertedCount++;
          
          // Update progress after conversion
          emitProgress(userId, {
            type: 'progress',
            progress: Math.round((convertedCount / spotifyTracks.length) * 100),
            jobId: job.id,
            songName: `Converting Spotify URLs (${convertedCount}/${spotifyTracks.length})`,
            isBulk: true
          });
          
          // Emit info message about the conversion
          emitProgress(userId, {
            type: 'info',
            jobId: job.id,
            songName: `Converted: "${song.title}" → YouTube Music`,
            isBulk: true
          });
        }
        
        processedUrls.push(url);
      } catch (error) {
        console.error(`Error processing URL for song ${song.title}:`, error);
        // Emit error message for failed conversion
        emitProgress(userId, {
          type: 'error',
          jobId: job.id,
          songName: `Failed to convert: "${song.title}"`,
          error: error instanceof Error ? error.message : 'Unknown error',
          isBulk: true
        });
        // Continue with other songs even if one fails
        continue;
      }
    }
    
    // If we converted Spotify tracks, update to show we're now starting downloads
    if (hasSpotifyTracks && convertedCount > 0) {
      emitProgress(userId, {
        type: 'progress',
        progress: 0,
        jobId: job.id,
        songName: `Starting download of ${processedUrls.length} songs`,
        isBulk: true
      });
    }
    
    // Write processed URLs to batch file
    await fs.writeFile(batchFile, processedUrls.join('\n'));
    console.log(`Created batch file with ${processedUrls.length} URLs`);

    // Get user's preferred format
    const userPreferredFormat = await getUserPreferredFormat(userId);
    // Use FLAC for download if user wants AIFF (we'll convert after)
    const downloadFormat = userPreferredFormat === 'aiff' ? 'flac' : userPreferredFormat;
    
    // Set the working directory to the output directory and use title-only template to avoid NA prefix
    const outputTemplate = "%(title)s.%(ext)s"; // Title only format
    console.log(`Using output template: ${outputTemplate} in directory: ${outputDir}`);
    
    // Log the command we're about to run for debugging
    console.log(`Running yt-dlp with ${processedUrls.length} URLs in ${outputDir}`);
    
    // Execute yt-dlp with batch file and progress tracking
    await new Promise<void>((resolve, reject) => {
      let completedSongs = 0;
      let currentSong = '';
      
      const ytDlpProcess = execFile(
        ytDlpPath,
        [
          '--batch-file', batchFile,
          '--extract-audio',
          '--audio-format', downloadFormat,
          '--audio-quality', '0',
          '--add-metadata',
          '--embed-thumbnail',
          '--convert-thumbnails', 'jpg',
          '--parse-metadata', 'title:%(title)s',
          '--parse-metadata', 'artist:%(artist)s',
          '--parse-metadata', 'album:%(album)s',
          '--output', outputTemplate,
          '--ffmpeg-location', path.dirname(ffmpegPath),
          '--progress',
          '--ignore-errors',
          '--no-abort-on-error',
          '--format', 'ba/b',
          '--no-playlist',
          '--embed-metadata',
          '--embed-chapters',
        ],
        {
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
          shell: true,
          cwd: outputDir // Set the working directory explicitly
        }
      );
      
      // Track progress from stdout
      ytDlpProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        
        // Check for download completion
        if (output.includes('has already been downloaded') || 
            output.includes('100%') || 
            output.includes('Downloading completed')) {
          completedSongs++;
          const progress = Math.round((completedSongs / totalSongs) * 100);
          
          // Update job progress
          job.progress(progress);
          
          // Emit progress event
          emitProgress(userId, {
            type: 'progress',
            progress,
            jobId: job.id,
            songName: `Downloading ${completedSongs}/${totalSongs} songs${currentSong ? `: ${currentSong}` : ''}`,
            isBulk: true
          });
        }
        
        // Extract current song being downloaded
        const titleMatch = output.match(/\[download\] Downloading video (\d+) of (\d+)/);
        if (titleMatch) {
          const [, current, total] = titleMatch;
          currentSong = `Song ${current}/${total}`;
          
          // Also emit progress update when starting a new song
          emitProgress(userId, {
            type: 'info',
            jobId: job.id,
            songName: `Processing: ${currentSong}`,
            isBulk: true
          });
        }
        
        // Also track percentage progress for more granular updates
        const percentMatch = output.match(/(\d+\.\d+)% of ~?\s*[\d.]+\w+/);
        if (percentMatch && titleMatch) {
          const [, current] = titleMatch;
          const percent = parseFloat(percentMatch[1]);
          if (percent && percent % 20 === 0) { // Update at 20%, 40%, 60%, 80%
            emitProgress(userId, {
              type: 'info',
              jobId: job.id,
              songName: `Song ${current}: ${percent}% downloaded`,
              isBulk: true
            });
          }
        }
      });

      // Handle errors
      ytDlpProcess.stderr?.on('data', (data: Buffer) => {
        const errorText = data.toString();
        console.error(`yt-dlp error: ${errorText}`);
        
        // Check if the error contains a video ID to extract the current song
        const videoIdMatch = errorText.match(/\[youtube\] ([a-zA-Z0-9_-]+)/);
        if (videoIdMatch) {
          const videoId = videoIdMatch[1];
          // Find which song in our list has this video ID
          const failedSong = processedUrls.findIndex(url => url.includes(videoId));
          if (failedSong !== -1) {
            emitProgress(userId, {
              type: 'info',
              jobId: job.id,
              songName: `Failed to download song #${failedSong + 1}`,
              isBulk: true
            });
          }
        }
      });

      // Handle process completion
      ytDlpProcess.on('close', async (code: number | null) => {
        try {
          console.log(`yt-dlp process exited with code ${code}`);
          
          // Check if any files were downloaded
          const files = await fs.readdir(outputDir);
          const audioFiles = files.filter(file => 
            !file.endsWith('.txt') && 
            !file.endsWith('.bat') &&
            !file.endsWith('.zip')
          );
          
          console.log(`Found ${audioFiles.length} downloaded files`);
          
          if (audioFiles.length > 0) {
            // Convert FLAC files to AIFF if user requested AIFF format
            if (userPreferredFormat === 'aiff') {
              console.log(`Converting FLAC files to AIFF for user preference...`);
              emitProgress(userId, {
                type: 'info',
                jobId: job.id,
                songName: `Converting ${audioFiles.length} files to AIFF format...`,
                isBulk: true
              });
              
              const flacFiles = audioFiles.filter(file => file.toLowerCase().endsWith('.flac'));
              console.log(`Found ${flacFiles.length} FLAC files to convert`);
              
              for (let i = 0; i < flacFiles.length; i++) {
                const flacFile = flacFiles[i];
                const flacPath = path.join(outputDir, flacFile);
                
                try {
                  console.log(`Converting file ${i + 1}/${flacFiles.length}: ${flacFile}`);
                  await convertFlacToAiff(flacPath);
                  
                  // Update progress
                  emitProgress(userId, {
                    type: 'info',
                    jobId: job.id,
                    songName: `Converted ${i + 1}/${flacFiles.length} files to AIFF`,
                    isBulk: true
                  });
                } catch (error) {
                  console.error(`Error converting ${flacFile} to AIFF:`, error);
                  // Continue with other files even if one conversion fails
                }
              }
              
              console.log(`AIFF conversion completed for ${flacFiles.length} files`);
            }
            
            // Some files were downloaded, consider it a success
            emitProgress(userId, {
              type: 'info',
              jobId: job.id,
              songName: `Successfully downloaded ${audioFiles.length}/${processedUrls.length} songs`,
              isBulk: true
            });
            resolve();
          } else {
            // No files downloaded at all
            reject(new Error("Failed to download any files"));
          }
        } catch (error) {
          console.error("Error handling process completion:", error);
          reject(error);
        }
      });
    });

    // Create a zip file with all downloaded songs
    console.log(`Creating zip file for ${totalSongs} songs...`);
    
    // Generate a unique zip filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFilename = `bulk-download-${timestamp}.zip`;
    const zipPath = path.join(outputDir, zipFilename);
    
    // Get all files in the bulk folder
    const files = await fs.readdir(outputDir);
    const songFiles = [];
    
    // Filter to only include actual files (not directories)
    for (const file of files) {
      if (file.endsWith('.zip') || 
          file.endsWith('.part') || 
          file.startsWith('.') ||
          file.endsWith('.txt')) {
        continue; // Skip these files
      }
      
      try {
        const filePath = path.join(outputDir, file);
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          songFiles.push(file);
        } else {
          console.log(`Skipping directory: ${file}`);
        }
      } catch (error) {
        console.error(`Error checking file ${file}:`, error);
      }
    }
    
    if (songFiles.length === 0) {
      throw new Error("No files were downloaded successfully");
    }
    
    // Create paths for all song files
    const filePaths = songFiles.map(file => path.join(outputDir, file));
    
    // Create the zip file
    await createZipFromFilePaths(filePaths, zipPath);
    console.log(`Created zip file: ${zipPath}`);
    
    // Update download status for all songs
    for (const song of songs) {
      try {
        await updateSongDownloadStatus(song.id, true);
        await updateSongLocalStatus(song.id, true);
      } catch (error) {
        console.error(`Error updating status for song ${song.id}:`, error);
      }
    }
    
    // Emit completion event
    emitProgress(userId, {
      type: 'complete',
      jobId: job.id,
      songName: `Bulk download (${songFiles.length}/${totalSongs} songs)`,
      filePath: zipFilename,
      isBulk: true
    });
    
    // Set job progress to 100% to mark it as completed
    await job.progress(100);
    
    // Update job data with results
    await job.update({
      ...job.data,
      zipPath: path.basename(zipPath),
      successCount: songFiles.length,
      failCount: totalSongs - songFiles.length
    });

    return {
      status: 'completed',
      filePath: path.basename(zipPath),
      userId,
      songCount: songFiles.length,
      failedCount: totalSongs - songFiles.length
    };
  } catch (error) {
    console.error(`Error processing bulk download:`, error);
    
    // Emit error with job info
    emitProgress(userId, {
      type: 'error',
      jobId: job.id,
      songName: `Bulk download (${bulkSongIds.length} songs)`,
      error: error instanceof Error ? error.message : 'Unknown error',
      isBulk: true
    });

    throw error;
  }
}

// Remove duplicate event handlers since we're already handling completion and errors in the process function
downloadQueue.on('failed', (job, error: Error) => {
  console.error(`Job ${job.id} failed:`, error);
}); 