import { LoaderFunction, json } from "@remix-run/node";
import path from "path";
import fs from "fs/promises";
import { downloadQueue } from "~/services/queue.server";
import { getSongById, updateSongDownloadStatus } from "~/services/db.server";
import { findMatchingFile } from "~/utils/file-matching.server";

export const loader: LoaderFunction = async ({ params }) => {
  const jobId = params.jobId;
  
  if (!jobId) {
    return json({ error: "Missing job ID" }, { status: 400 });
  }

  try {
    // Get job from queue
    const job = await downloadQueue.getJob(jobId);
    if (!job) {
      return json({ error: "Job not found" }, { status: 404 });
    }

    // Get job data
    const { songId, userId } = job.data;

    // Get song details
    const song = await getSongById(songId);
    if (!song) {
      return json({ error: "Song not found" }, { status: 404 });
    }

    // Get directory path
    const dirPath = path.join(
      process.cwd(),
      "tmp",
      userId,
      song.playlist || 'default'
    );

    // Find matching file using our improved matching function
    const artistName = Array.isArray(song.artist_name) 
      ? song.artist_name.join(' ') 
      : typeof song.artist_name === 'string' 
        ? song.artist_name 
        : undefined;
    
    const downloadFile = await findMatchingFile(dirPath, song.title || '', artistName);

    if (!downloadFile) {
      return new Response("File not found", { status: 404 });
    }

    const absolutePath = path.join(dirPath, downloadFile);
    const fileBuffer = await fs.readFile(absolutePath);
    
    // Create a clean filename for the download that includes artist name
    const filenameBase = path.parse(downloadFile).name;
    const filenameExt = path.parse(downloadFile).ext || '.flac'; // Default to .flac if no extension
    
    // Format artist name - ensure it's a clean comma-separated list
    let artistDisplay = '';
    if (Array.isArray(song.artist_name)) {
      // Clean up each artist name and join with commas
      artistDisplay = song.artist_name
        .map(artist => String(artist).replace(/[[\]_]/g, '').trim())
        .filter(Boolean)
        .join(', ');
    } else if (typeof song.artist_name === 'string') {
      // Clean up string representation if it looks like an array
      artistDisplay = String(song.artist_name)
        .replace(/[[\]_]/g, '')  // Remove brackets and underscores
        .replace(/,/g, ', ')     // Ensure spaces after commas
        .replace(/\s+/g, ' ')    // Normalize whitespace
        .trim();
    }
    
    // Create filename with format: "Artist1, Artist2, Artist3 - title.flac"
    const songTitle = (song.title || filenameBase).trim();
    const cleanFilename = artistDisplay 
      ? `${artistDisplay} - ${songTitle}${filenameExt}`
      : `${songTitle}${filenameExt}`;
    
    const encodedFilename = encodeURIComponent(cleanFilename)
      .replace(/['()]/g, escape)
      .replace(/\*/g, '%2A');
    
    const headers = new Headers();
    headers.set("Content-Type", "audio/flac");
    headers.set("Content-Disposition", `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    headers.set("Content-Length", fileBuffer.length.toString());
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");

    // set song as downloaded
    await updateSongDownloadStatus(songId, true);

    return new Response(fileBuffer, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Error serving file:", error);
    return json(
      { error: "Error serving file" },
      { status: 500 }
    );
  }
}; 