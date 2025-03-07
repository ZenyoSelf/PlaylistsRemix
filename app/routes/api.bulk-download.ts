import { ActionFunction, json } from "@remix-run/node";
import { getUserSongsFromDB } from "~/services/db.server";
import { getProviderSession } from "~/services/auth.server";
import { createZipFromSongs } from "~/services/zipService.server";
import fs from "fs/promises";
import { downloadQueue } from "~/services/queue.server";
import { emitProgress } from "~/workers/downloadWorker.server";

export const action: ActionFunction = async ({ request }) => {
  try {
    // Get user email from session
    const spotifySession = await getProviderSession(request, "spotify");
    const youtubeSession = await getProviderSession(request, "youtube");
    
    // Get emails from both sessions if available
    const spotifyEmail = spotifySession?.email || '';
    const youtubeEmail = youtubeSession?.email || '';
    
    // Check if at least one provider is authenticated
    if (!spotifyEmail && !youtubeEmail) {
      return json({ error: "User not authenticated" }, { status: 401 });
    }
    
    // Use the first available email
    const userEmail = spotifyEmail || youtubeEmail;
    
    // Parse request body
    const { songIds, filterParams } = await request.json();
    
    // If songIds is provided, use those specific songs
    // Otherwise, use the filter parameters to get songs
    let songs = [];
    
    if (songIds && Array.isArray(songIds) && songIds.length > 0) {
      // Get songs from DB based on IDs
      const result = await getUserSongsFromDB(request, {
        songIds
      });
      songs = result.songs;
    } else if (filterParams) {
      // Get songs from DB based on filter parameters
      const result = await getUserSongsFromDB(request, {
        ...filterParams,
        // Override itemsPerPage to get all songs
        itemsPerPage: 1000
      });
      songs = result.songs;
    } else {
      return json({ error: "No songs specified" }, { status: 400 });
    }
    
    // Check if there are any songs to download
    if (songs.length === 0) {
      return json({ error: "No songs found" }, { status: 404 });
    }
    
    // Create a unique job ID for this bulk download
    const jobId = `bulk-${Date.now()}`;
    
    // Add job to queue
    await downloadQueue.add({
      type: 'bulk',
      userId: userEmail,
      songs,
      jobId
    }, {
      jobId
    });
    
    // Emit queued event
    emitProgress(userEmail, {
      type: 'queued',
      progress: 0,
      jobId,
      songName: `Bulk download (${songs.length} songs)`
    });
    
    return json({
      success: true,
      jobId,
      message: `Bulk download of ${songs.length} songs queued successfully`,
      songCount: songs.length
    });
  } catch (error) {
    console.error("Error queuing bulk download:", error);
    return json(
      { error: error instanceof Error ? error.message : "Failed to queue bulk download" },
      { status: 500 }
    );
  }
}; 