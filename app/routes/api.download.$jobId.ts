import { LoaderFunction, json } from "@remix-run/node";
import path from "path";
import { createReadStream, statSync } from "fs";
import { downloadQueue } from "~/services/queue.server";
import { getSongById, updateSongDownloadStatus } from "~/services/db.server";
import { findMatchingFile } from "~/utils/file-matching.server";
import { sanitizeDirectoryName } from "~/utils/file-utils";

export const loader: LoaderFunction = async ({ params, request }) => {
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
    const { songId = '', userId = '', sanitizedPlaylistName } = job.data;

    // Get song details
    const song = await getSongById(songId);
    if (!song) {
      return json({ error: "Song not found" }, { status: 404 });
    }

    // Use sanitizedPlaylistName from job data if available, otherwise sanitize the playlist name
    let playlistName;
    if (sanitizedPlaylistName) {
      playlistName = sanitizedPlaylistName;
    } else {
      // Get the first playlist name or use 'default' if none exists
      const rawPlaylistName = song.playlists && song.playlists.length > 0 
        ? song.playlists[0].name 
        : (Array.isArray(song.playlist) && song.playlist.length > 0 
          ? song.playlist[0] 
          : 'default');
      
      // Sanitize the playlist name to avoid issues with special characters like emojis
      playlistName = sanitizeDirectoryName(rawPlaylistName);
    }

    // Get directory path
    const dirPath = path.join(
      process.cwd(),
      "tmp",
      userId,
      playlistName
    );

    // Find matching file using our improved matching function
    const artistName = Array.isArray(song.artist_name) 
      ? song.artist_name.join(' ') 
      : typeof song.artist_name === 'string' 
        ? song.artist_name 
        : '';
    
    const songTitle = song.title || '';
    const downloadFile = await findMatchingFile(dirPath, songTitle, artistName);

    if (!downloadFile) {
      return new Response("File not found", { status: 404 });
    }

    const absolutePath = path.join(dirPath, downloadFile);
    
    // Get file stats to determine size
    const stats = statSync(absolutePath);
    const fileSize = stats.size;
    
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
    const songTitleFormatted = (song.title || filenameBase).trim();
    const cleanFilename = artistDisplay 
      ? `${artistDisplay} - ${songTitleFormatted}${filenameExt}`
      : `${songTitleFormatted}${filenameExt}`;
    
    const encodedFilename = encodeURIComponent(cleanFilename)
      .replace(/['()]/g, escape)
      .replace(/\*/g, '%2A');
    
    // Check for range headers (for resumable downloads)
    const rangeHeader = request.headers.get("Range");
    let start = 0;
    let end = fileSize - 1;
    let statusCode = 200;
    
    // Handle range requests (resumable downloads)
    if (rangeHeader) {
      const matches = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (matches) {
        start = parseInt(matches[1], 10);
        if (matches[2]?.length > 0) {
          end = parseInt(matches[2], 10);
        }
        statusCode = 206; // Partial content
      }
    }
    
    const contentLength = end - start + 1;
    
    const headers = new Headers();
    headers.set("Content-Type", "audio/flac");
    headers.set("Content-Disposition", `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    headers.set("Accept-Ranges", "bytes");
    
    if (statusCode === 206) {
      // For partial content
      headers.set("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      headers.set("Content-Length", contentLength.toString());
    } else {
      // For full content
      headers.set("Content-Length", fileSize.toString());
    }
    
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");

    // set song as downloaded
    await updateSongDownloadStatus(songId, true);

    // Create a readable stream for the file
    const fileStream = createReadStream(absolutePath, { start, end });
    
    // Create a stream response
    const stream = new ReadableStream({
      start(controller) {
        // Handle stream events
        fileStream.on('data', (chunk) => {
          controller.enqueue(chunk);
        });
        
        fileStream.on('end', () => {
          controller.close();
        });
        
        fileStream.on('error', (error) => {
          console.error(`Error streaming file: ${error}`);
          controller.error(error);
        });
      },
      
      cancel() {
        fileStream.destroy();
      }
    });

    return new Response(stream, {
      status: statusCode,
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