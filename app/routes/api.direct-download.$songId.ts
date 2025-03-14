import { LoaderFunction, json } from "@remix-run/node";
import path from "path";
import fs from "fs/promises";
import { getSongById, updateSongDownloadStatus, updateSongLocalStatus } from "~/services/db.server";
import { findMatchingFile } from "~/utils/file-matching.server";
import { sanitizeDirectoryName } from "~/utils/file-utils";

export const loader: LoaderFunction = async ({ params, request }) => {
  const songId = params.songId;
  
  if (!songId) {
    return json({ error: "Missing song ID" }, { status: 400 });
  }

  try {
    // Get song details
    const song = await getSongById(songId);
    if (!song) {
      return json({ error: "Song not found" }, { status: 404 });
    }

    // Get user ID from query parameter
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    
    if (!userId) {
      return json({ error: "Missing user ID" }, { status: 400 });
    }
    
    // Ensure userId is a string
    const userIdStr = String(userId);

    // Get the first playlist name or use 'default' if none exists
    const rawPlaylistName = song.playlists && song.playlists.length > 0 
      ? song.playlists[0].name 
      : (Array.isArray(song.playlist) && song.playlist.length > 0 
        ? song.playlist[0] 
        : 'default');
    
    // Sanitize the playlist name to avoid issues with special characters like emojis
    const playlistName = sanitizeDirectoryName(rawPlaylistName);

    // Get directory path
    const dirPath = path.join(
      process.cwd(),
      "tmp",
      userIdStr,
      playlistName
    );

    try {
      // Find matching file using our improved matching function
      const artistName = Array.isArray(song.artist_name) 
        ? song.artist_name.join(' ') 
        : typeof song.artist_name === 'string' 
          ? song.artist_name 
          : undefined;
      
      const downloadFile = await findMatchingFile(dirPath, song.title || '', artistName);

      if (!downloadFile) {
        await updateSongLocalStatus(songId, false);
        return json({ error: "File not found on disk" }, { status: 404 });
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

      // Update song status
      await updateSongDownloadStatus(songId, true);
      await updateSongLocalStatus(songId, true);

      return new Response(fileBuffer, {
        status: 200,
        headers,
      });
    } catch (error) {
      // If directory doesn't exist or can't be read, file is not local
      await updateSongLocalStatus(songId, false);
      return json({ error: "File not found on disk" }, { status: 404 });
    }
  } catch (error) {
    console.error("Error serving file:", error);
    return json(
      { error: "Error serving file" },
      { status: 500 }
    );
  }
}; 