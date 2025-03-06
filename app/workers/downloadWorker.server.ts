import { downloadQueue } from '~/services/queue.server';
import path from 'path';
import { downloadSpotifySong } from '~/services/selfApi.server';
import { getSongById, updateSongDownloadStatus, updateSongLocalStatus } from '~/services/db.server';

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

export function emitProgress(userId: string, data: ProgressData) {
  const controller = downloadStreams.get(userId);
  if (controller) {
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  }
}

// Process download jobs
downloadQueue.process(async (job) => {
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
    const playlistName = Array.isArray(song.playlist) && song.playlist.length > 0 
      ? song.playlist[0] 
      : 'default';

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
    console.error(`Download failed:`, error);
    emitProgress(userId, {
      type: 'error',
      jobId: job.id,
      songName: song?.title || 'Unknown Song',
      error: error instanceof Error ? error.message : 'Download failed'
    });
    throw error;
  }
});

// Remove duplicate event handlers since we're already handling completion and errors in the process function
downloadQueue.on('failed', (job, error: Error) => {
  console.error(`Job ${job.id} failed:`, error);
}); 