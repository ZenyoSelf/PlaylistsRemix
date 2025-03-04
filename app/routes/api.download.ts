import { json } from '@remix-run/node';
import type { ActionFunction } from '@remix-run/node';
import { getSongById } from '~/services/db.server';
import { downloadQueue } from '~/services/queue.server';
import { emitProgress } from '~/workers/downloadWorker.server';

export const action: ActionFunction = async ({ request }) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const { songId, userId } = await request.json();
    
    // Get song details first
    const song = await getSongById(songId);
    if (!song) {
      return json(
        { error: 'Song not found' },
        { status: 400 }
      );
    }

    // Add job to queue
    const job = await downloadQueue.add({
      songId: songId,
      userId: userId,
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });

    // Emit queued event immediately
    emitProgress(userId, {
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