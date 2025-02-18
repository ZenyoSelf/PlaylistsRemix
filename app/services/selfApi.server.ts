import { execFile } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { convertSpotifyToYouTubeMusic } from "./spotToYt.server";
import { spotifyStrategy } from "./auth.server";
import fs from "fs/promises";
import archiver from "archiver";
import { Stream } from "stream";

if (!process.env.SPOTIFY_CLIENT_ID) {
  throw new Error("Missing SPOTIFY_CLIENT_ID env");
}

if (!process.env.SPOTIFY_CLIENT_SECRET) {
  throw new Error("Missing SPOTIFY_CLIENT_SECRET env");
}

if (!process.env.SPOTIFY_CALLBACK_URL) {
  throw new Error("Missing SPOTIFY_CALLBACK_URL env");
}

// Use import.meta.url to get the current file URL and derive the directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Construct the path to the yt-dlp.exe executable
const ytDlpPath = path.resolve(__dirname, "../utils/yt-dlp.exe");
const ffmpegPath = path.resolve(__dirname, "../utils/ffmpeg.exe");
const ffprobePath = path.resolve(__dirname, "../utils/ffprobe.exe");

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getLikedSongsSpotify(
  offset: number,
  limit: number,
  accessToken: string
) {
  let likedSongs: unknown[] = [];

  try {
    const fetchLikedSongsTracks = (
      limit: number,
      offset: number
    ): Promise<SpotifyApi.UsersSavedTracksResponse> =>
      fetch(
        `https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      ).then(async (r) => await r.json());

    const data = await fetchLikedSongsTracks(limit, offset);
    console.log(data);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    likedSongs = likedSongs.concat(data.items); // Concatenate new songs to the existing list
    offset += limit; // Increment offset for pagination
    return data;
  } catch (error) {
    console.error("Error fetching liked songs:", error);
  }
}


export async function getTotalLikedSongsSpotify(request: Request): Promise<number> {
  const session = await spotifyStrategy.getSession(request);
  if (!session) {
    throw new Error("No session established to spotify");
  }

  return fetch(
    `https://api.spotify.com/v1/me/tracks?limit=${0}&offset=${0}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${session?.accessToken}` },
    }
  ).then(async (r) => {
    const data = (await r.json()) as SpotifyApi.UsersSavedTracksResponse;
    return data.total
  }
  );

}


export async function downloadSpotifySong(
  trackName: string,
  artists: string[],
  playlistName: string
): Promise<string> {
  try {
    const song = await convertSpotifyToYouTubeMusic(trackName, artists);
    
    if (!song) {
      throw new Error(`Could not find YouTube video for: ${trackName} by ${artists.join(", ")}`);
    }

    const outputDir = path.join(process.cwd(), "tmp", playlistName);
    await fs.mkdir(outputDir, { recursive: true });

    // Create filename template with artist and title
    const filename = `${artists.join(", ")} - ${trackName}`;

    await new Promise((resolve, reject) => {
      execFile(
        ytDlpPath,
        [
          song.toString(),
          "-f", "bestaudio",
          "-x",
          "--audio-format", "flac",
          "--audio-quality", "0",
          "--add-metadata",
          "--embed-thumbnail",
          "-o", `"${outputDir}/${filename}.%(ext)s"`,  // Use our custom filename
          "--ffmpeg-location", `"${path.dirname(ffmpegPath)}"`,
          "--no-mtime",
        ],
        {
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
          shell: true
        },
        (error, stdout, stderr) => {
          if (error) reject(error);
          else resolve(stdout);
        }
      );
    });

    // Wait a moment for the file to be fully written THIS SHIT NEEDS TO BE FIXED
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get the downloaded file path
    const files = await fs.readdir(outputDir);
    if (files.length === 0) throw new Error("No file was downloaded");
    
    // Find our specific file
    const downloadedFile = files.find(file => file.startsWith(filename));
    if (!downloadedFile) throw new Error("Could not find downloaded file");
    
    return path.join(outputDir, downloadedFile);

  } catch (error) {
    console.error("Download process error:", error);
    throw error;
  }
}

export async function downloadMultipleSongs(
  songs: { trackName: string; artists: string[] }[],
  playlistName: string
): Promise<string[]> {
  try {
    const downloadedFiles: string[] = [];

    for (const song of songs) {
      const filePath = await downloadSpotifySong(
        song.trackName,
        song.artists,
        playlistName
      );
      downloadedFiles.push(filePath);
    }

    return downloadedFiles;
  } catch (error) {
    console.error("Multiple download error:", error);
    throw error;
  }
}
