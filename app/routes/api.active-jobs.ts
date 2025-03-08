import { LoaderFunction, json } from "@remix-run/node";
import { downloadQueue, DownloadJobData } from "~/services/queue.server";
import { Job } from "bull";
import { getSongById } from "~/services/db.server";
import path from "path";
import fs from "fs/promises";

// Helper function to safely serialize job data
async function serializeJob(job: Job<DownloadJobData>) {
  // Check if this is a bulk download job
  if (job.data.type === 'bulk' && job.data.bulkSongIds) {
    return {
      id: job.id,
      data: {
        userId: job.data.userId,
        songName: `Bulk download (${job.data.bulkSongIds.length} songs)`,
        type: 'bulk',
        zipPath: job.data.zipPath
      },
      progress: job.progress || 0,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      isBulk: true
    };
  }
  
  // For regular download jobs, fetch song details from the database
  const songId = job.data.songId || '';
  const song = await getSongById(songId);
  
  return {
    id: job.id,
    data: {
      songId: songId,
      userId: job.data.userId,
      songName: song?.title || 'Unknown Song' // Use actual song title from database
    },
    progress: job.progress || 0,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
    isBulk: false
  };
}

// Check if a completed bulk download zip file exists
async function checkCompletedBulkDownload(jobId: string, userId: string) {
  try {
    const zipPath = path.join(process.cwd(), "tmp", userId, `${jobId}.zip`);
    await fs.access(zipPath);
    return true;
  } catch (error) {
    return false;
  }
}

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");

  if (!userId) {
    return json({ error: "Missing user ID" }, { status: 400 });
  }

  try {
    // Get jobs from the queue
    const activeJobs = await downloadQueue.getActive();
    const waitingJobs = await downloadQueue.getWaiting();
    const delayedJobs = await downloadQueue.getDelayed();
    const completedJobs = await downloadQueue.getCompleted(0, 10); // Get the last 10 completed jobs
    
    // Filter jobs for the current user
    const userActiveJobs = activeJobs.filter(job => job.data.userId === userId);
    const userWaitingJobs = waitingJobs.filter(job => job.data.userId === userId);
    const userDelayedJobs = delayedJobs.filter(job => job.data.userId === userId);
    const userCompletedJobs = completedJobs.filter(job => job.data.userId === userId);
    
    // Create promises for all jobs
    const activeJobPromises = userActiveJobs.map(async job => {
      const serialized = await serializeJob(job);
      return { ...serialized, status: 'downloading' };
    });
    
    const waitingJobPromises = userWaitingJobs.map(async job => {
      const serialized = await serializeJob(job);
      return { ...serialized, status: 'queued' };
    });
    
    const delayedJobPromises = userDelayedJobs.map(async job => {
      const serialized = await serializeJob(job);
      return { ...serialized, status: 'queued' };
    });
    
    // Process completed jobs - only include bulk downloads that have a zip file
    const completedJobPromises = userCompletedJobs.map(async job => {
      // Only include bulk downloads that have a zip file
      if (job.data.type === 'bulk') {
        const hasZipFile = await checkCompletedBulkDownload(job.id.toString(), userId);
        if (hasZipFile) {
          const serialized = await serializeJob(job);
          return { ...serialized, status: 'completed' };
        }
      }
      return null;
    });
    
    // Combine and resolve all promises
    const allJobs = await Promise.all([
      ...activeJobPromises,
      ...waitingJobPromises,
      ...delayedJobPromises,
      ...completedJobPromises
    ]);
    
    // Filter out null values (completed jobs without zip files)
    const filteredJobs = allJobs.filter(job => job !== null);
    
    return json({ jobs: filteredJobs });
  } catch (error) {
    console.error("Error fetching active jobs:", error);
    return json(
      { error: "Error fetching active jobs" },
      { status: 500 }
    );
  }
}; 