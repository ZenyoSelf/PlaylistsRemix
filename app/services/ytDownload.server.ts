import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { Song } from "~/types/customs";

// Construct __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ytDlpPath = path.resolve(__dirname, "../utils/yt-dlp.exe");

export async function downloadYouTubeVideo(
  videoUrl: string,
  outputDir: string,
  userId: string
): Promise<string> {
  try {
    // Create user directory if it doesn't exist
    const userDir = path.join(outputDir, userId);
    await fs.mkdir(userDir, { recursive: true });
    
    // Set output template for the downloaded file
    const outputTemplate = path.join(userDir, "%(title)s.%(ext)s");
    
    // Execute yt-dlp to download the video as audio
    const result = await new Promise<string>((resolve, reject) => {
      execFile(
        ytDlpPath,
        [
          videoUrl,
          "--extract-audio",
          "--audio-format", "mp3",
          "--audio-quality", "0", // Best quality
          "--output", outputTemplate,
          "--no-playlist",
          "--no-warnings",
          "--quiet"
        ],
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        async (error, stdout, stderr) => {
          if (error) {
            reject(error);
          } else {
            // Get the filename from stdout or find it in the directory
            const files = await fs.readdir(userDir);
            // Find the most recently created file
            const fileStat = await Promise.all(
              files.map(async (file) => {
                const stats = await fs.stat(path.join(userDir, file));
                return { file, stats };
              })
            );
            
            fileStat.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
            
            if (fileStat.length > 0) {
              resolve(path.join(userDir, fileStat[0].file));
            } else {
              reject(new Error("Could not find downloaded file"));
            }
          }
        }
      );
    });
    
    return result;
  } catch (error) {
    console.error("Error downloading YouTube video:", error);
    throw error;
  }
}

export async function downloadMultipleYouTubeVideos(
  songs: { song: Song; userId: string }[],
  outputDir: string
): Promise<string[]> {
  const results: string[] = [];
  
  for (const { song, userId } of songs) {
    try {
      const filePath = await downloadYouTubeVideo(song.url, outputDir, userId);
      results.push(filePath);
    } catch (error) {
      console.error(`Error downloading ${song.title}:`, error);
      results.push(`Failed to download: ${song.title}`);
    }
  }
  
  return results;
} 