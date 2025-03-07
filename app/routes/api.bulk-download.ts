import { ActionFunction, json } from "@remix-run/node";
import { getDb,  getUserId } from "~/services/db.server";
import { getProviderSession } from "~/services/auth.server";

import { downloadQueue } from "~/services/queue.server";
import { emitProgress } from "~/workers/downloadWorker.server";

export const action: ActionFunction = async ({ request }) => {
  try {

    const db = await getDb();
    // Get user email from session
    const spotifySession = await getProviderSession(request, "spotify");
    const youtubeSession = await getProviderSession(request, "youtube");

    // Get emails from both sessions if available
    const spotifyEmail = spotifySession?.email || '';
    const youtubeEmail = youtubeSession?.email || '';

    let userId;
    // Check if at least one provider is authenticated
    if (!spotifyEmail && !youtubeEmail) {
      return json({ error: "User not authenticated" }, { status: 401 });
    } else {
      if (spotifyEmail) {
        userId = await getUserId(db, spotifyEmail, "spotify");
      } else {
        userId = await getUserId(db, youtubeEmail, "youtube");
      }
    }


    // Parse request body
    const { songIds } = await request.json();


    if (!songIds && !Array.isArray(songIds) && songIds.length <= 0) {
      return json({ error: "No songs specified" }, { status: 400 });
    } 

    // Check if there are any songs to download
    if (songIds.length === 0) {
      return json({ error: "No songs found" }, { status: 404 });
    }

    // Create a unique job ID for this bulk download
    const jobId = `bulk-${Date.now()}`;

    // Add job to queue
    await downloadQueue.add({
      type: 'bulk',
      userId: userId.toString(),
      bulkSongIds: songIds
    }, {
      jobId
    });

    // Emit queued event
    emitProgress(userId.toString(), {
      type: 'queued',
      progress: 0,
      jobId,
      songName: `Bulk download (${songIds.length} songs)`
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