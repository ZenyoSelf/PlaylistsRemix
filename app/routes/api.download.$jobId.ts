import { LoaderFunction } from "@remix-run/node";
import path from "path";
import fs from "fs/promises";
import { downloadQueue } from "~/services/queue.server";
import { getSongById } from "~/services/db.server";

export const loader: LoaderFunction = async ({ params }) => {
  const jobId = params.jobId;
  
  if (!jobId) {
    return new Response("Missing job ID", { status: 400 });
  }

  try {
    // Get job from queue
    const job = await downloadQueue.getJob(jobId);
    if (!job) {
      return new Response("Job not found", { status: 404 });
    }

    // Get job data
    const { songId, userId } = job.data;

    // Get song details
    const song = await getSongById(songId);
    if (!song) {
      return new Response("Song not found", { status: 404 });
    }

    // Get directory path
    const dirPath = path.join(
      process.cwd(),
      "tmp",
      userId,
      song.playlist || 'default'
    );

    // List files in directory and find the one we want
    const files = await fs.readdir(dirPath);
    const downloadFile = files.find(file => file.endsWith('.flac'));

    if (!downloadFile) {
      return new Response("File not found", { status: 404 });
    }

    const absolutePath = path.join(dirPath, downloadFile);
    const fileBuffer = await fs.readFile(absolutePath);
    
    const headers = new Headers();
    headers.set("Content-Type", "audio/flac");
    headers.set("Content-Disposition", `attachment; filename="${downloadFile}"`);
    headers.set("Content-Length", fileBuffer.length.toString());
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");

    return new Response(fileBuffer, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Error serving file:", error);
    return new Response("Error serving file", { status: 500 });
  }
}; 