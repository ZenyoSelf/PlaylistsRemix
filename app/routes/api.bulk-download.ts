import { ActionFunction, json } from "@remix-run/node";
import { getDb, getUserId } from "~/services/db.server";
import { downloadQueue } from "~/services/queue.server";
import { emitProgress } from "~/workers/downloadWorker.server";
import path from 'path';
import fs from 'fs/promises';

export const action: ActionFunction = async ({ request }) => {
  try {
    const db = await getDb();

    const { songIds, spotifyEmail, youtubeEmail } = await request.json();
    let userId;
    // Check if at least one provider is authenticated
    if (!spotifyEmail && !youtubeEmail) {
      return json({ error: "No spotifyEmail or youtubeEmail from the request" }, { status: 401 });
    } else {
      if (spotifyEmail) {
        userId = await getUserId(db, spotifyEmail, "spotify");
      } else {
        userId = await getUserId(db, youtubeEmail, "youtube");
      }
    }

    // Ensure userId is a string
    const userIdStr = String(userId);

    if (!songIds || !Array.isArray(songIds) || songIds.length <= 0) {
      return json({ error: "No songs specified" }, { status: 400 });
    }

    // Check if there are any songs to download
    if (songIds.length === 0) {
      return json({ error: "No songs found" }, { status: 404 });
    }

    // Create the bulk folder before queueing the job
    const bulkFolderName = "bulk";
    const bulkDir = path.join(process.cwd(), "tmp", userIdStr, bulkFolderName);
    try {
      await fs.mkdir(bulkDir, { recursive: true });
      console.log(`Created bulk directory: ${bulkDir}`);
    } catch (error) {
      console.error(`Error creating bulk directory: ${bulkDir}`, error);
      // Continue with the job even if directory creation fails
      // The download worker will try to create it again
    }

    // Create a unique job ID for this bulk download
    const jobId = `bulk-${Date.now()}`;

    // Add job to queue
    await downloadQueue.add({
      type: 'bulk',
      userId: userIdStr,
      bulkSongIds: songIds
    }, {
      jobId
    });

    // Emit queued event
    emitProgress(userIdStr, {
      type: 'queued',
      progress: 0,
      jobId,
      songName: `Bulk download (${songIds.length} songs)`,
      isBulk: true
    });

    return json({
      success: true,
      jobId,
      message: `Bulk download of ${songIds.length} songs queued successfully`,
      songCount: songIds.length
    });
  } catch (error) {
    console.error("Error queuing bulk download:", error);
    return json(
      { error: error instanceof Error ? error.message : "Failed to queue bulk download" },
      { status: 500 }
    );
  }
}; 