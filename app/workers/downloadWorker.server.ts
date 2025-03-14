import { downloadQueue } from '~/services/queue.server';
import path from 'path';
import { downloadSpotifySong } from '~/services/selfApi.server';
import { getSongById, getSongsByIds, updateSongDownloadStatus, updateSongLocalStatus } from '~/services/db.server';
import { createZipFromFilePaths } from '~/services/zipService.server';
import fs from 'fs/promises';
import { Job } from 'bull';
import { sanitizeDirectoryName } from '~/utils/file-utils';

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
  
  // Track successful and failed downloads
  const successfulDownloads: string[] = [];
  const failedDownloads: string[] = [];
  
  try {
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
    
    // Process songs that need to be downloaded
    for (let treatedSongs = 0; treatedSongs < songs.length; treatedSongs++) {
      const song = songs[treatedSongs];
      try {
        // Calculate progress percentage
        const progress = Math.round((treatedSongs / totalSongs) * 100);
        
        // Update job progress in the queue
        await job.progress(progress);
        
        // Emit progress event to clients
        emitProgress(userId, {
          type: 'progress',
          progress,
          jobId: job.id,
          songName: `Downloading ${treatedSongs + 1}/${totalSongs}: ${song.title || 'Unknown'}`,
          isBulk: true
        });

        // Ensure artist_name is an array
        let artists: string[] = [];
        if (Array.isArray(song.artist_name)) {
          artists = song.artist_name;
        } else if (typeof song.artist_name === 'string') {
          const artistString = song.artist_name as string;
          artists = artistString.split(',').map((a: string) => a.trim()).filter(Boolean);
        }

        console.log(`Processing song ${treatedSongs + 1}/${totalSongs}: "${song.title}" by "${artists.join(', ')}"`);

        // Download the song to the bulk folder
        await downloadSpotifySong(song.title || 'Unknown', artists, bulkFolderName, userId);

        // Track successful download - but don't update DB status yet
        // We'll update the status after confirming the file is in the zip
        successfulDownloads.push(song.id);
        console.log(`Successfully downloaded song: "${song.title}" by "${artists.join(', ')}"`);

      } catch (error) {
        console.error(`Error downloading song ${song.id} (${song.title}):`, error);
        failedDownloads.push(song.id);
        
        // Continue with the next song
        continue;
      }
    }
    
    // Create a zip file with all downloaded songs
    console.log(`Creating zip file for ${successfulDownloads.length} songs...`);
    
    // Generate a unique zip filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFilename = `bulk-download-${timestamp}.zip`;
    const zipPath = path.join(outputDir, zipFilename);
    
    // Get all files in the bulk folder
    const files = await fs.readdir(outputDir);
    const songFiles = files.filter(file => 
      !file.endsWith('.zip') && 
      !file.endsWith('.part') && 
      !file.startsWith('.')
    );
    
    if (songFiles.length === 0) {
      throw new Error("No files were downloaded successfully");
    }
    
    // Create paths for all song files
    const filePaths = songFiles.map(file => path.join(outputDir, file));
    
    // Create the zip file using the new function
    await createZipFromFilePaths(filePaths, zipPath);
    console.log(`Created zip file: ${zipPath}`);
    
    // Update download status for all successful songs
    const includedInZip = [...successfulDownloads];
    for (const songId of includedInZip) {
      try {
        await updateSongDownloadStatus(songId, true);
        await updateSongLocalStatus(songId, true);
      } catch (error) {
        console.error(`Error updating status for song ${songId}:`, error);
      }
    }
    
    // Emit completion event
    emitProgress(userId, {
      type: 'complete',
      jobId: job.id,
      songName: `Bulk download (${includedInZip.length}/${totalSongs} songs)`,
      filePath: zipFilename,
      isBulk: true
    });
    
    // Set job progress to 100% to mark it as completed
    await job.progress(100);
    
    // Update job data to include the zip path and download statistics
    await job.update({
      ...job.data,
      zipPath: path.basename(zipPath),
      successCount: includedInZip.length,
      failCount: failedDownloads.length
    });

    return {
      status: 'completed',
      filePath: path.basename(zipPath),
      userId,
      songCount: includedInZip.length,
      failedCount: failedDownloads.length
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