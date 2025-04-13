import { LoaderFunction, json } from "@remix-run/node";
import path from "path";
import { createReadStream, statSync } from "fs";
import { downloadQueue } from "~/services/queue.server";
import { emitProgress } from "~/workers/downloadWorker.server";

export const loader: LoaderFunction = async ({ params, request }) => {
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
      // Check if the file exists using synchronous method to avoid extra async operations
      if (!statSync(zipPath).isFile()) {
        throw new Error("Not a file");
      }
    } catch (error) {
      console.error(`Zip file not found at ${zipPath}:`, error);
      return json({ error: "Zip file not found or not ready yet" }, { status: 404 });
    }

    // Get file stats to determine size
    const stats = statSync(zipPath);
    const fileSize = stats.size;

    // Create a clean filename with date
    const date = new Date().toISOString().slice(0, 10);
    const filename = `bulk-download-${date}.zip`;
    const encodedFilename = encodeURIComponent(filename);
    
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
    
    // Notify client that download is starting
    emitProgress(userId, {
      type: 'progress',
      progress: 100,
      jobId,
      songName: `Starting download of bulk file (${Math.round(fileSize / 1024 / 1024 * 10) / 10} MB)`,
      isBulk: true
    });
    
    // Set headers for download
    const headers = new Headers();
    headers.set("Content-Type", "application/zip");
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

    // Create a readable stream for the file
    const fileStream = createReadStream(zipPath, { start, end });
    
    // Create a stream response
    const stream = new ReadableStream({
      start(controller) {
        // Handle stream events
        fileStream.on('data', (chunk) => {
          controller.enqueue(chunk);
        });
        
        fileStream.on('end', () => {
          controller.close();
          // Notify client that download is complete
          emitProgress(userId, {
            type: 'progress',
            progress: 100,
            jobId,
            songName: `Download complete: ${filename}`,
            isBulk: true
          });
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
    console.error(`Error serving zip file for job ${jobId}:`, error);
    return json(
      { error: "Error serving zip file" },
      { status: 500 }
    );
  }
}; 