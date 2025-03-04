import { LoaderFunction } from "@remix-run/node";
import path from "path";
import fs from "fs/promises";

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const filePath = url.searchParams.get("filePath");
  const userId = url.searchParams.get("userId");
  const playlist = url.searchParams.get("playlist");

  if (!filePath || !userId || !playlist) {
    return new Response("Missing file path or user ID", { status: 400 });
  }

  try {
    console.log("File path:", filePath);
    const absolutePath = path.join(process.cwd(), "tmp", userId, playlist, filePath);


    const fileExists = await fs.access(absolutePath)
      .then(() => true)
      .catch(() => false);

    if (!fileExists) {
      return new Response("File not found", { status: 404 });
    }

    const fileBuffer = await fs.readFile(absolutePath);
    const headers = new Headers();
    headers.set("Content-Type", "audio/flac");
    headers.set("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
    headers.set("Content-Length", fileBuffer.length.toString());
    // Prevent caching
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