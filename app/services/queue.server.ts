import Queue from 'bull';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { ExpressAdapter } from '@bull-board/express';

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

// Setup Bull Board for monitoring
const serverAdapter = new ExpressAdapter();
createBullBoard({
  queues: [new BullAdapter(downloadQueue)],
  serverAdapter,
});

// Export the middleware for use in your Express app
export const bullBoardMiddleware = serverAdapter.getRouter(); 