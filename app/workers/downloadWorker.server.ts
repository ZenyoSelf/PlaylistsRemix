import { downloadQueue } from '~/services/queue.server';
import path from 'path';
import { downloadSpotifySong } from '~/services/selfApi.server';
import { getSongById, updateSongDownloadStatus, updateSongLocalStatus } from '~/services/db.server';
import { createZipFromSongs } from '~/services/zipService.server';

// Map to store event sources for each user
const eventSources = new Map<string, Set<(data: ProgressData) => void>>();

interface ProgressData {
  type: 'progress' | 'complete' | 'error' | 'queued';
  progress?: number;
  jobId: string | number;
  songName: string;
  filePath?: string;
  error?: string;
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
  if (job.data.type === 'bulk' && job.data.songs) {
    return processBulkDownload(job);
  } else {
    return processSingleDownload(job);
  }
});

// Process a single song download
async function processSingleDownload(job) {
  const { songId, userId } = job.data;
  const song = await getSongById(songId);
  try {
    // Get song details from your database
    
    if (!song) {
      throw new Error('Song not found');
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

    // Get the first playlist name or use 'default' if none exists
    const playlistName = song.playlists && song.playlists.length > 0 
      ? song.playlists[0].name 
      : (Array.isArray(song.playlist) && song.playlist.length > 0 
        ? song.playlist[0] 
        : 'default');

    // Download the song
    const result = await downloadSpotifySong(song.title!, artists, playlistName, userId);
    const { path: filePath } = JSON.parse(result);

    // Update progress to 100% with job info
    emitProgress(userId, {
      type: 'progress',
      progress: 100,
      jobId: job.id,
      songName: song.title || 'Unknown Song'
    });

    // Update song status in database
    await updateSongDownloadStatus(songId, true);
    await updateSongLocalStatus(songId, true);

    // Emit completion with job info
    emitProgress(userId, {
      type: 'complete',
      jobId: job.id,
      songName: song.title || 'Unknown Song',
      filePath: path.basename(filePath)
    });

    return {
      status: 'completed',
      filePath: path.basename(filePath),
      userId,
      songName: song.title
    };
  } catch (error) {
    console.error(`Error downloading song ${songId}:`, error);
    
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
async function processBulkDownload(job) {
  const { userId, songs, jobId } = job.data;
  
  try {
    // Start download with job info
    emitProgress(userId, {
      type: 'progress',
      progress: 0,
      jobId: job.id,
      songName: `Bulk download (${songs.length} songs)`
    });
    
    // Filter songs that are already downloaded
    const downloadedSongs = songs.filter(song => song.downloaded && song.local);
    const notDownloadedSongs = songs.filter(song => !song.downloaded || !song.local);
    
    // Update progress as we go
    let processedCount = 0;
    const totalSongs = songs.length;
    
    // Process songs that need to be downloaded
    for (const song of notDownloadedSongs) {
      try {
        // Update progress
        const progress = Math.round((processedCount / totalSongs) * 100);
        emitProgress(userId, {
          type: 'progress',
          progress,
          jobId: job.id,
          songName: `Downloading ${processedCount + 1}/${totalSongs}: ${song.title}`
        });
        
        // Ensure artist_name is an array
        let artists: string[] = [];
        if (Array.isArray(song.artist_name)) {
          artists = song.artist_name;
        } else if (typeof song.artist_name === 'string') {
          const artistString = song.artist_name as string;
          artists = artistString.split(',').map((a: string) => a.trim()).filter(Boolean);
        }
        
        // Get the first playlist name or use 'default' if none exists
        const playlistName = song.playlists && song.playlists.length > 0 
          ? song.playlists[0].name 
          : (Array.isArray(song.playlist) && song.playlist.length > 0 
            ? song.playlist[0] 
            : 'default');
        
        // Download the song
        await downloadSpotifySong(song.title!, artists, playlistName, userId);
        
        // Update song status in database
        await updateSongDownloadStatus(song.id.toString(), true);
        await updateSongLocalStatus(song.id.toString(), true);
        
        processedCount++;
      } catch (error) {
        console.error(`Error downloading song ${song.title}:`, error);
        // Continue with next song
        processedCount++;
      }
    }
    
    // Create a zip file with all songs
    emitProgress(userId, {
      type: 'progress',
      progress: 90,
      jobId: job.id,
      songName: `Creating zip file with ${songs.length} songs`
    });
    
    const zipPath = await createZipFromSongs(songs, userId, jobId);
    
    // Update progress to 100% with job info
    emitProgress(userId, {
      type: 'progress',
      progress: 100,
      jobId: job.id,
      songName: `Bulk download (${songs.length} songs)`
    });
    
    // Emit completion with job info
    emitProgress(userId, {
      type: 'complete',
      jobId: job.id,
      songName: `Bulk download (${songs.length} songs)`,
      filePath: path.basename(zipPath)
    });
    
    return {
      status: 'completed',
      filePath: path.basename(zipPath),
      userId,
      songCount: songs.length
    };
  } catch (error) {
    console.error(`Error processing bulk download:`, error);
    
    // Emit error with job info
    emitProgress(userId, {
      type: 'error',
      jobId: job.id,
      songName: `Bulk download (${songs.length} songs)`,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    throw error;
  }
}

// Remove duplicate event handlers since we're already handling completion and errors in the process function
downloadQueue.on('failed', (job, error: Error) => {
  console.error(`Job ${job.id} failed:`, error);
}); 