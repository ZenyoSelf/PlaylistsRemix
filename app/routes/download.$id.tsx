import { json, LoaderFunction } from "@remix-run/node";
import { createReadStream } from "fs";
import fs from "fs/promises";
import path from "path";
import { downloadSpotifySong } from "~/services/selfApi.server";
import { getSongById } from "~/services/db.server";

type ToastData = {
  title: string;
  description: string;
  variant: "default" | "destructive";
};

export const loader: LoaderFunction = async ({ params }) => {
  try {
    const songId = params.id;
    if (!songId) {
      return json({ 
        toast: {
          title: "Error",
          description: "Song ID is required",
          variant: "destructive"
        } as ToastData
      }, { status: 400 });
    }

    const song = await getSongById(songId);
    if (!song) {
      return json({ 
        toast: {
          title: "Error",
          description: "Song not found",
          variant: "destructive"
        } as ToastData
      }, { status: 404 });
    }

    const filePath = await downloadSpotifySong(
      song.title,
      JSON.parse(song.artist_name),
      song.playlist
    );

    const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
    if (!fileExists) {
      return json({ 
        toast: {
          title: "Download Failed",
          description: "File not found after download",
          variant: "destructive"
        } as ToastData
      }, { status: 404 });
    }

    const fileName = path.basename(filePath);
    const stats = await fs.stat(filePath);
    
    const fileStream = createReadStream(filePath);

    fileStream.on('end', () => {
      fs.unlink(filePath).catch(console.error);
    });

    return json({ 
      toast: {
        title: "Success",
        description: `Downloaded ${fileName}`,
        variant: "default"
      } as ToastData,
      downloadPath: filePath
    }, {
      status: 200,
      headers: {
        "Content-Type": "audio/flac",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
        "Content-Length": stats.size.toString(),
        "X-Download-Status": "success",
        "X-Download-Filename": fileName
      },
    });
  } catch (error) {
    return json({ 
      toast: {
        title: "Download Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      } as ToastData
    }, { status: 500 });
  }
}; 