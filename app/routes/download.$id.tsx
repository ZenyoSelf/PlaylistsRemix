import { createReadableStreamFromReadable, LoaderFunction } from "@remix-run/node";
import { createReadStream } from "fs";
import fs from "fs/promises";
import { downloadSpotifySong } from "~/services/selfApi.server";
import { getSongById } from "~/services/db.server";
import { jsonWithError } from "remix-toast";
import path from "path";

export const loader: LoaderFunction = async ({ params }) => {
  try {
    const songId = params.id;
    if (!songId) {
      return jsonWithError({
        result: "Error",
      }, "No song ID provided");
    }

    const song = await getSongById(songId);
    if (!song) {
      return jsonWithError({
        result: "error",
      }, "No Song Found");
    }
    console.log(song.artist_name)

    // Get directory path
    const dirPath = path.join(
      process.cwd(),
      "tmp",
      "arnaud",
      Array.isArray(song.playlist) && song.playlist.length > 0 
        ? song.playlist[0] 
        : 'default'
    );

    // List files in directory and find the one we want
    const files = await fs.readdir(dirPath);
    const downloadFile = files.find(file => file.includes(song.title!));
    
    if (downloadFile) {
      return jsonWithError({
        result: "error",
      }, "File already exists");
    }
    
    // Get the first playlist name or use 'default' if none exists
    const playlistName = song.playlists && song.playlists.length > 0 
      ? song.playlists[0].name 
      : (Array.isArray(song.playlist) && song.playlist.length > 0 
        ? song.playlist[0] 
        : 'default');
    
    const result = await downloadSpotifySong(
      song.title!,
      song.artist_name!,
      playlistName,
      "arnaud"
    );

    const { path: filePath, originalName } = JSON.parse(result);

    const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
    if (!fileExists) {
      return jsonWithError({
        result: "error",
      }, "File not found after download");
    }

    const fileStream = createReadStream(filePath);
    const readableStream = createReadableStreamFromReadable(fileStream);

    fileStream.on('end', () => {
      fs.unlink(filePath).catch(console.error);
    });

    return new Response(readableStream, {
      status: 200,
      headers: {
        "Content-Type": "audio/flac",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(originalName)}"`,
        "Content-Length": (await fs.stat(filePath)).size.toString(),
      },
    });
  } catch (error) {
    console.error("Download error:", error);
    return jsonWithError({
      result: "error",
    }, error instanceof Error ? error.message : "Unknown error");
  }
}; 