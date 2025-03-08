import { LoaderFunction, json } from "@remix-run/node";
import path from "path";
import fs from "fs/promises";
import { downloadQueue } from "~/services/queue.server";
import { emitProgress } from "~/workers/downloadWorker.server";

export const loader: LoaderFunction = async ({ params }) => {
  const jobId = params.jobId;
  
  if (!jobId) {
    return json({ error: "Missing job ID" }, { status: 400 });
  }

  try {
    // Get job from queue
    const job = await downloadQueue.getJob(jobId);
    if (!job) {
      console.error(`Job not found: ${jobId}`);
      return json({ error: "Job not found" }, { status: 404 });
    }

    // Get job data
    const { userId } = job.data;
    
    // Get the zip file path - use the job ID as the filename
    const zipPath = path.join(
      process.cwd(),
      "tmp",
      userId,
      `${jobId}.zip`
    );

    console.log(`Attempting to serve zip file from: ${zipPath}`);

    try {
      // Check if the file exists
      await fs.access(zipPath);
    } catch (error) {
      console.error(`Zip file not found at ${zipPath}:`, error);
      return json({ error: "Zip file not found or not ready yet" }, { status: 404 });
    }

    // Get file stats to determine size
    const stats = await fs.stat(zipPath);
    const fileSize = stats.size;

    // Notify client that download is starting
    emitProgress(userId, {
      type: 'progress',
      progress: 100,
      jobId,
      songName: `Starting download of bulk file (${Math.round(fileSize / 1024 / 1024 * 10) / 10} MB)`,
      isBulk: true
    });

    // Read the file
    const fileBuffer = await fs.readFile(zipPath);
    
    // Create a clean filename with date
    const date = new Date().toISOString().slice(0, 10);
    const filename = `bulk-download-${date}.zip`;
    const encodedFilename = encodeURIComponent(filename);
    
    // Set headers for download
    const headers = new Headers();
    headers.set("Content-Type", "application/zip");
    headers.set("Content-Disposition", `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    headers.set("Content-Length", fileSize.toString());
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");

    // Notify client that download is complete
    emitProgress(userId, {
      type: 'progress',
      progress: 100,
      jobId,
      songName: `Download complete: ${filename}`,
      isBulk: true
    });

    return new Response(fileBuffer, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error(`Error serving zip file for job ${jobId}:`, error);
    return json(
      { error: "Error serving zip file" },
      { status: 500 }
    );
  }
}; 