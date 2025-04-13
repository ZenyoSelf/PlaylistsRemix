import { ActionFunction, json } from "@remix-run/node";
import { downloadQueue } from "~/services/queue.server";
import { emitProgress } from "~/workers/downloadWorker.server";

export const action: ActionFunction = async ({ request, params }) => {
  const jobId = params.jobId;
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");

  if (!jobId || !userId) {
    return json({ error: "Missing job ID or user ID" }, { status: 400 });
  }

  try {
    // Get the job from the queue
    const job = await downloadQueue.getJob(jobId);
    
    if (!job) {
      return json({ error: "Job not found" }, { status: 404 });
    }

    // Check if the job belongs to the user
    if (job.data.userId !== userId) {
      return json({ error: "Unauthorized" }, { status: 403 });
    }

    // Get song name from the job data
    let songName = 'Unknown Song';
    if (job.data.type === 'bulk') {
      songName = `Bulk download (${job.data.bulkSongIds?.length || 0} songs)`;
    } else if (job.data.songId) {
      songName = `Song ID: ${job.data.songId}`;
    }

    // Emit a cancellation event to the client
    emitProgress(userId, {
      type: 'usercancelled',
      jobId,
      songName,
      error: 'Job cancelled by user',
      isBulk: job.data.type === 'bulk'
    });

    // Remove the job from the queue
    await job.remove();

    return json({ success: true });
  } catch (error) {
    console.error(`Error cancelling job ${jobId}:`, error);
    return json(
      { error: "Error cancelling job" },
      { status: 500 }
    );
  }
}; 