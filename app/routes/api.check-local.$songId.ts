import { LoaderFunction, json } from "@remix-run/node";

import { getSongById } from "~/services/db.server";

// Helper function to add delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const loader: LoaderFunction = async ({ params }) => {
  const songId = params.songId;
  
  if (!songId) {
    return json({ error: "Missing song ID" }, { status: 400 });
  }

  try {
    // Add a small delay to throttle requests (100-300ms)
    await delay(Math.floor(Math.random() * 200) + 100);
    
    // Get song details
    const song = await getSongById(songId);
    return json({ isLocal: song?.local });
    
  } catch (error) {
    console.error("Error checking file:", error);
    return json(
      { error: "Error checking file", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}; 