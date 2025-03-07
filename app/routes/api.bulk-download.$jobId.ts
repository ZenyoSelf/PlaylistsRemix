import { LoaderFunction, json } from "@remix-run/node";
import path from "path";
import fs from "fs/promises";
import { downloadQueue } from "~/services/queue.server";
import { getProviderSession } from "~/services/auth.server";

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
    const { userId } = job.data;
    
    // Verify the user is authorized to download this file
    const spotifySession = await getProviderSession(request, "spotify");
    const youtubeSession = await getProviderSession(request, "youtube");
    
    const spotifyEmail = spotifySession?.email || '';
    const youtubeEmail = youtubeSession?.email || '';
    
    // Check if the user is authorized
    if (userId !== spotifyEmail && userId !== youtubeEmail) {
      return json({ error: "Unauthorized" }, { status: 403 });
    }

    // Get the zip file path
    const zipPath = path.join(
      process.cwd(),
      "tmp",
      userId,
      `${jobId}.zip`
    );

    try {
      // Check if the file exists
      await fs.access(zipPath);
    } catch (error) {
      return json({ error: "Zip file not found or not ready yet" }, { status: 404 });
    }

    // Read the file
    const fileBuffer = await fs.readFile(zipPath);
    
    // Set headers for download
    const headers = new Headers();
    headers.set("Content-Type", "application/zip");
    headers.set("Content-Disposition", `attachment; filename="new-additions.zip"`);
    headers.set("Content-Length", fileBuffer.length.toString());
    headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    headers.set("Pragma", "no-cache");
    headers.set("Expires", "0");

    return new Response(fileBuffer, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Error serving zip file:", error);
    return json(
      { error: "Error serving zip file" },
      { status: 500 }
    );
  }
}; 