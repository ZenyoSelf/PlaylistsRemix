import { LoaderFunction, json } from "@remix-run/node";
import path from "path";
import fs from "fs/promises";
import { getSongById, updateSongLocalStatus } from "~/services/db.server";
import { findMatchingFile } from "~/utils/file-matching.server";

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

    // Get directory path
    const dirPath = path.join(
      process.cwd(),
      "tmp",
      userId,
      song.playlist || 'default'
    );

    // Check if directory exists
    try {
      await fs.access(dirPath);
    } catch (error) {
      // Directory doesn't exist, file is not local
      await updateSongLocalStatus(songId, false);
      return json({ isLocal: false });
    }

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
  } catch (error) {
    console.error("Error checking file:", error);
    return json(
      { error: "Error checking file" },
      { status: 500 }
    );
  }
}; 