import { LoaderFunction, json } from "@remix-run/node";
import { downloadQueue, DownloadJobData } from "~/services/queue.server";
import { Job } from "bull";
import { getSongById } from "~/services/db.server";

// Helper function to safely serialize job data
async function serializeJob(job: Job<DownloadJobData>) {
  // Fetch song details from the database
  const song = await getSongById(job.data.songId);
  
  return {
    id: job.id,
    data: {
      songId: job.data.songId,
      userId: job.data.userId,
      songName: song?.title || 'Unknown Song' // Use actual song title from database
    },
    progress: job.progress || 0,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp
  };
}

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");

  if (!userId) {
    return json({ error: "Missing user ID" }, { status: 400 });
  }

  try {
    // Get active jobs from the queue
    const activeJobs = await downloadQueue.getActive();
    const waitingJobs = await downloadQueue.getWaiting();
    const delayedJobs = await downloadQueue.getDelayed();
    
    // Filter jobs for the current user
    const userActiveJobs = activeJobs.filter(job => job.data.userId === userId);
    const userWaitingJobs = waitingJobs.filter(job => job.data.userId === userId);
    const userDelayedJobs = delayedJobs.filter(job => job.data.userId === userId);
    
    // Create promises for all jobs
    const activeJobPromises = userActiveJobs.map(async job => {
      const serialized = await serializeJob(job);
      return { ...serialized, status: 'active' };
    });
    
    const waitingJobPromises = userWaitingJobs.map(async job => {
      const serialized = await serializeJob(job);
      return { ...serialized, status: 'queued' };
    });
    
    const delayedJobPromises = userDelayedJobs.map(async job => {
      const serialized = await serializeJob(job);
      return { ...serialized, status: 'delayed' };
    });
    
    // Combine and resolve all promises
    const allJobs = await Promise.all([
      ...activeJobPromises,
      ...waitingJobPromises,
      ...delayedJobPromises
    ]);
    
    return json({ jobs: allJobs });
  } catch (error) {
    console.error("Error fetching active jobs:", error);
    return json(
      { error: "Error fetching active jobs" },
      { status: 500 }
    );
  }
}; 