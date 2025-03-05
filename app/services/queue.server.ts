import Queue from 'bull';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { cleanupOldFiles } from '~/workers/cleanupWorker.server';

// Define job data interface
export interface DownloadJobData {
  songId: string;
  userId: string;
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

// Create cleanup queue with recurring job
export const cleanupQueue = new Queue('cleanup-queue', {
  redis: {
    host: 'localhost',
    port: 6379,
  }
});

// Add recurring job to run every day at midnight
cleanupQueue.add(
  {},
  {
    repeat: {
      cron: '0 0 * * *' // Run at midnight every day
    }
  }
);

// Process cleanup jobs
cleanupQueue.process(async () => {
  await cleanupOldFiles();
  return { success: true };
});

// Setup Bull Board for monitoring
const serverAdapter = new ExpressAdapter();
createBullBoard({
  queues: [new BullAdapter(downloadQueue)],
  serverAdapter,
});

// Export the middleware for use in your Express app
export const bullBoardMiddleware = serverAdapter.getRouter(); 