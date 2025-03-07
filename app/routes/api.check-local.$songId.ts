import { LoaderFunction, json } from "@remix-run/node";
import path from "path";
import fs from "fs/promises";
import { getSongById, updateSongLocalStatus } from "~/services/db.server";
import { findMatchingFile } from "~/utils/file-matching.server";

// Helper function to add delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const loader: LoaderFunction = async ({ params, request }) => {
  const songId = params.songId;
  
  if (!songId) {
    return json({ error: "Missing song ID" }, { status: 400 });
  }

  try {
    // Add a small delay to throttle requests (100-300ms)
    await delay(Math.floor(Math.random() * 200) + 100);
    
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

    // Get the first playlist name or use 'default' if none exists
    const playlistName = song.playlists && song.playlists.length > 0 
      ? song.playlists[0].name 
      : (Array.isArray(song.playlist) && song.playlist.length > 0 
        ? song.playlist[0] 
        : 'default');

    // Get directory path
    const dirPath = path.join(
      process.cwd(),
      "tmp",
      userId,
      playlistName
    );

    // Check if directory exists, if not, just return isLocal: false without error
    let dirExists = false;
    try {
      await fs.access(dirPath);
      dirExists = true;
    } catch (error) {
      // Directory doesn't exist, file is not local
      console.log(`Directory does not exist: ${dirPath}`);
      await updateSongLocalStatus(songId, false);
      return json({ isLocal: false });
    }

    // Only proceed with file matching if directory exists
    if (dirExists) {
      // Find matching file using our improved matching function
      const artistName = Array.isArray(song.artist_name) 
        ? song.artist_name.join(' ') 
        : typeof song.artist_name === 'string' 
          ? song.artist_name 
          : undefined;
      
      const matchingFile = await findMatchingFile(dirPath, song.title || '', artistName);

      if (matchingFile) {
        // File exists locally
        await updateSongLocalStatus(songId, true);
        return json({ isLocal: true, fileName: matchingFile });
      } else {
        // File not found
        await updateSongLocalStatus(songId, false);
        return json({ isLocal: false });
      }
    }
    
    return json({ isLocal: false });
  } catch (error) {
    console.error("Error checking file:", error);
    return json(
      { error: "Error checking file", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}; 