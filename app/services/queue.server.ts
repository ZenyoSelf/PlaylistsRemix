import Queue from 'bull';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { cleanupOldFiles } from '~/workers/cleanupWorker.server';
import { Song } from '~/types/customs';

// Define job data interface
export interface DownloadJobData {
  songId?: string;
  userId: string;
  type?: 'single' | 'bulk';
  songs?: Song[];
  bulkSongIds?: string[];
  jobId?: string;
  zipPath?: string;
  sanitizedPlaylistName?: string;
  originalPlaylistName?: string;
}

// Create download queue
export const downloadQueue = new Queue<DownloadJobData>('download-queue', {
  redis: {
    host: 'localhost',
    port: 6379,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: false,
    removeOnFail: false,
  },
});

// Create cleanup queue
export const cleanupQueue = new Queue('cleanup-queue', {
  redis: {
    host: 'localhost',
    port: 6379,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: true,
  },
});

// Process cleanup jobs
cleanupQueue.process(async () => {
  console.log('Running cleanup job...');
  console.log('NOT ACTIVATED...');
  try {
   // await cleanupOldFiles();
    return { success: true };
  } catch (error) {
    console.error('Error during cleanup:', error);
    return { success: false, error: String(error) };
  }
});

// Schedule cleanup job to run every 2 days
cleanupQueue.add(
  {},
  {
    repeat: {
      cron: '0 0 */2 * *', // Every 2 days at midnight
    },
  }
);

// Setup Bull Board for monitoring
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [
    new BullAdapter(downloadQueue),
    new BullAdapter(cleanupQueue),
  ],
  serverAdapter,
});

export { serverAdapter }; 