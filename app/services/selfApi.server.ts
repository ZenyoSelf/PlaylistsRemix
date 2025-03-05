import { execFile } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { convertSpotifyToYouTubeMusic } from "./spotToYt.server";
import { spotifyStrategy } from "./auth.server";
import fs from "fs/promises";
import { Song } from "~/types/customs";

interface SpotifyTrack {
  total: number;
  items: Array<unknown>;
}

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
    ): Promise<SpotifyTrack> =>
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

  const response = await fetch(
    `https://api.spotify.com/v1/me/tracks?limit=${0}&offset=${0}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${session?.accessToken}` },
    }
  );
  const data = (await response.json()) as SpotifyTrack;
  return data.total;
}

function normalizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[()[\]{}]/g, '') // Remove brackets
    .replace(/[-_]/g, ' ')     // Replace dashes and underscores with spaces
    .replace(/\s+/g, ' ')      // Normalize spaces
    .trim();
}

function findMatchingFile(files: string[], trackName: string, artists: string[]): string | undefined {
  // Create variations of the expected filename
  const variations = [
    `${artists.join(",")} - ${trackName}`, // Original format
    trackName,                             // Just the track name
    normalizeFilename(`${artists.join(",")} - ${trackName}`), // Normalized version
  ];

  // Try exact matches first
  for (const file of files) {
    const fileWithoutExt = path.parse(file).name;
    if (variations.includes(fileWithoutExt)) {
      return file;
    }
  }

  // Try normalized comparison
  const normalizedFiles = files.map(file => ({
    original: file,
    normalized: normalizeFilename(path.parse(file).name)
  }));

  // Try to find a match using normalized versions
  for (const variation of variations) {
    const normalized = normalizeFilename(variation);
    const match = normalizedFiles.find(file => 
      file.normalized.includes(normalized) || normalized.includes(file.normalized)
    );
    if (match) {
      return match.original;
    }
  }

  return undefined;
}

export async function downloadSpotifySong(
  trackName: string,
  artists: string[],
  playlistName: string,
  userId: string
): Promise<string> {
  try {
    const song = await convertSpotifyToYouTubeMusic(trackName, artists);

    if (!song) {
      throw new Error(`Could not find YouTube video for: ${trackName} by ${artists.join(", ")}`);
    }

    const outputDir = path.join(process.cwd(), "tmp", userId, playlistName);
    console.log(outputDir)
    await fs.mkdir(outputDir, { recursive: true });

    // Store original filename for Content-Disposition
    const originalFilename = `${artists.join(",")} - ${trackName}`;

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
          "-o", `"%(artist)s - %(title)s.%(ext)s"`,
          "-P", `"${outputDir}"`,
          "--windows-filenames",
          "--ffmpeg-location", path.dirname(ffmpegPath),
          "--no-mtime",
        ],
        {
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
          shell: true
        },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        }
      );
    });

    // Get the downloaded file path
    const files = await fs.readdir(outputDir);
    if (files.length === 0) throw new Error("No file was downloaded");

    console.log("Available files:", files);
    console.log("Looking for track:", trackName);
    
    const downloadedFile = findMatchingFile(files, trackName, artists);
    if (!downloadedFile) throw new Error("Could not find downloaded file");

    const filePath = path.join(outputDir, downloadedFile);
    console.log("File found:", filePath);
    // Return both the file path and original filename
    return JSON.stringify({
      path: filePath,
      originalName: originalFilename
    });

  } catch (error) {
    console.error("Download process error:", error);
    throw error;
  }
}

export async function downloadMultipleSongs(
  songs: { song: Song; userId: string }[],
  playlistName: string
): Promise<string[]> {
  try {
    const downloadedFiles: string[] = [];

    for (const { song, userId } of songs) {
      const filePath = await downloadSpotifySong(
        song.title!,
        song.artist_name!,
        playlistName,
        userId,
      );
      downloadedFiles.push(filePath);
    }

    return downloadedFiles;
  } catch (error) {
    console.error("Multiple download error:", error);
    throw error;
  }
}
