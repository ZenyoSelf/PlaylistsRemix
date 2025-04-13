import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

// Construct __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ytDlpPath = path.resolve(__dirname, "../utils/yt-dlp.exe");

export async function convertSpotifyToYouTubeMusic(
  trackName: string,
  trackArtists: string[]
): Promise<string> {
  try {
    const searchQuery = `${trackName} ${trackArtists.join(" ")}`;
    
    // Use yt-dlp to search YouTube Music and get video ID
    const videoId = await new Promise<string>((resolve, reject) => {
      execFile(
        ytDlpPath,
        [
          `ytsearch1:${searchQuery}`,  // Get first result only
          "--no-playlist",
          "--get-id",   // Get only the video ID
          "--no-warnings",
          "--extractor-args", "youtube:player_client=android"
        ],
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout.trim());
        }
      );
    });

    if (!videoId) {
      throw new Error(`No results found for: ${searchQuery}`);
    }

    const ytMusicUrl = `https://music.youtube.com/watch?v=${videoId}`;
    console.log("Found YouTube Music URL:", ytMusicUrl);

    return ytMusicUrl;
  } catch (error) {
    console.error("Error searching with yt-dlp:", error);
    throw error;
  }
}
