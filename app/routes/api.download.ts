import { json } from '@remix-run/node';
import type { ActionFunction } from '@remix-run/node';
import { getSongById } from '~/services/db.server';
import { downloadQueue } from '~/services/queue.server';

export const action: ActionFunction = async ({ request }) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const { songId,  userId } = await request.json();
    const song = await getSongById(songId);

    if (!song  || !userId ) {
      return json(
        { error: 'Missing required fields: songId, userID or song could not be found' },
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