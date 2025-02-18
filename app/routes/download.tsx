import type { ActionFunction } from "@remix-run/node";
import { downloadSpotifySong } from "~/services/selfApi.server";
import { createReadStream } from "fs";
import path from "path";
import fs from "fs/promises";
export const action: ActionFunction = async ({ request }) => {
    const formData = await request.formData();
    const songName = formData.get("songName") as string;
    const artists = formData.getAll("artist") as string[];
    const playlistName = formData.get("playlistName") as string;

    try {
        const filePath = await downloadSpotifySong(songName, artists, playlistName);
        const stats = await fs.stat(filePath);
        const fileName = path.basename(filePath);

        const stream = createReadStream(filePath);

        const response = new Response(stream as unknown as Readable, {
            status: 200,
            headers: {
                "Content-Type": "audio/flac",
                "Content-Disposition": `attachment; filename="${fileName}"`,
                "Content-Length": stats.size.toString(),
            },
        });

        stream.on('end', () => {
            fs.unlink(filePath).catch(console.error);
        });

        return response;
    } catch (error) {
        console.error("Download error:", error);
        throw error;
    }
}; 