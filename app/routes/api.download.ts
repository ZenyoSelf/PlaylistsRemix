import { json } from '@remix-run/node';
import type { ActionFunction } from '@remix-run/node';
import { getSongById } from '~/services/db.server';
import { downloadQueue } from '~/services/queue.server';
import { emitProgress } from '~/workers/downloadWorker.server';
import path from 'path';
import fs from 'fs/promises';
import { sanitizeDirectoryName } from '~/utils/file-utils';

export const action: ActionFunction = async ({ request }) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const { songId, userId } = await request.json();
    
    // Ensure userId is a string
    const userIdStr = String(userId);
    
    // Get song details first
    const song = await getSongById(songId);
    if (!song) {
      return json(
        { error: 'Song not found' },
        { status: 400 }
      );
    }

    // Determine the playlist name
    const playlistName = song.playlists && song.playlists.length > 0 
      ? song.playlists[0].name 
      : (Array.isArray(song.playlist) && song.playlist.length > 0 
        ? song.playlist[0] 
        : 'default');
    
    // Sanitize the playlist name to avoid issues with special characters like emojis
    const sanitizedPlaylistName = sanitizeDirectoryName(playlistName);

    // Create the output directory structure before queueing the job
    const outputDir = path.join(process.cwd(), "tmp", userIdStr, sanitizedPlaylistName);
    try {
      await fs.mkdir(outputDir, { recursive: true });
      console.log(`Created output directory: ${outputDir}`);
    } catch (error) {
      console.error(`Error creating output directory: ${outputDir}`, error);
      // Continue with the job even if directory creation fails
      // The download worker will try to create it again
    }

    // Add job to queue with sanitized playlist name
    const job = await downloadQueue.add({
      songId: songId,
      userId: userIdStr,
      sanitizedPlaylistName: sanitizedPlaylistName,
      originalPlaylistName: playlistName
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });

    // Emit queued event immediately
    emitProgress(userIdStr, {
      type: 'queued',
      progress: 0,
      jobId: job.id,
      songName: song.title || 'Unknown Song'
    });

    return json({
      success: true,
      jobId: job.id,
      message: 'Download job queued successfully',
    });
  } catch (error) {
    console.error('Error queuing download job:', error);
    return json(
      { error: error instanceof Error ? error.message : 'Failed to queue download' },
      { status: 500 }
    );
  }
}; 