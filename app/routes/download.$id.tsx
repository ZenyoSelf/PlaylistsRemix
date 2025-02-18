import { createReadableStreamFromReadable, LoaderFunction } from "@remix-run/node";
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { downloadSpotifySong } from "~/services/selfApi.server";
import { getSongById } from "~/services/db.server";

export const loader: LoaderFunction = async ({ params }) => {
  try {
    const songId = params.id;
    if (!songId) throw new Error("Song ID is required");

    // Get song details from DB
    const song = await getSongById(songId);
    if (!song) throw new Error("Song not found");

    // Download the song
    const filePath = await downloadSpotifySong(
      song.title,
      JSON.parse(song.artist_name), // Parse the JSON string to array
      song.playlist
    );

    // Verify file exists
    const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
    if (!fileExists) {
      throw new Error(`File not found at path: ${filePath}`);
    }

    const fileName = path.basename(filePath);
    const stats = await fs.stat(filePath);

    // Create readable stream
    const fileStream = createReadStream(filePath);
    const readableStream = createReadableStreamFromReadable(fileStream);

    // Clean up file after stream ends
    fileStream.on('end', () => {
      fs.unlink(filePath).catch(console.error);
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "audio/flac",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
        "Content-Length": stats.size.toString(),
      },
    });
  } catch (error) {
    console.error("Download error:", error);
    throw error;
  }
}; 