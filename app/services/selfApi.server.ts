import { execFile } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { convertSpotifyToYouTubeMusic } from "./spotToYt.server";
import fs from "fs/promises";
import { Song, SpotifyTrackItem, SpotifyTrack, SpotifyPlaylist } from "~/types/customs";
import { getProviderSession } from "./auth.server";

// Define interfaces for Spotify API responses
// Removed interfaces as they are now imported from customs.ts

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
): Promise<SpotifyTrack | null> {
  try {
    const response = await fetch(
      `https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      console.error(`Spotify API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    
    // Validate the response structure
    if (!data || !data.items || !Array.isArray(data.items)) {
      console.error("Invalid response format from Spotify API:", data);
      return null;
    }
    
    console.log(`Retrieved ${data.items.length} liked songs from Spotify`);
    return data;
  } catch (error) {
    console.error("Error fetching liked songs:", error);
    return null;
  }
}

export async function getUserPlaylistsSpotify(accessToken: string) {
  try {
    const response = await fetch(
      'https://api.spotify.com/v1/me/playlists',
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    
    const data = await response.json();
    return data.items; // Array of playlist objects
  } catch (error) {
    console.error('Error fetching playlists:', error);
    throw error;
  }
}

export async function getAllUserPlaylistsSpotify(accessToken: string) {
  try {
    const limit = 50; // Maximum limit allowed by Spotify API
    let offset = 0;
    let allPlaylists: SpotifyPlaylist[] = [];
    let hasMore = true;

    while (hasMore) {
      const response = await fetch(
        `https://api.spotify.com/v1/me/playlists?limit=${limit}&offset=${offset}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Spotify API error (${response.status}): ${errorText}`);
        
        if (response.status === 401) {
          throw new Error("Spotify access token expired or invalid. Please re-authenticate with Spotify.");
        }
        
        throw new Error(`Failed to fetch playlists: ${response.statusText} (${response.status}). Details: ${errorText}`);
      }

      const data = await response.json();
      
      if (!data || !data.items) {
        console.error("Invalid response format from Spotify API:", data);
        throw new Error("Invalid response format from Spotify API");
      }
      
      console.log(`Retrieved ${data.items.length} playlists from offset ${offset}`);
      
      if (data.items && data.items.length > 0) {
        allPlaylists = allPlaylists.concat(data.items);
      }

      if (data.next && data.items.length === limit) {
        offset += limit;
      } else {
        hasMore = false;
      }
    }

    console.log(`Total playlists retrieved: ${allPlaylists.length}`);
    return allPlaylists;
  } catch (error) {
    console.error('Error fetching all playlists:', error);
    throw error;
  }
}

export async function getPlaylistTracksSpotify(accessToken: string, playlistId: string) {
  try {
    const limit = 100; // Maximum limit allowed by Spotify API
    let offset = 0;
    let allTracks: SpotifyTrackItem[] = [];
    let hasMore = true;

    while (hasMore) {
      const response = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Spotify API error (${response.status}): ${errorText}`);
        
        if (response.status === 401) {
          throw new Error("Spotify access token expired or invalid. Please re-authenticate with Spotify.");
        }
        
        throw new Error(`Failed to fetch playlist tracks: ${response.statusText} (${response.status}). Details: ${errorText}`);
      }

      const data = await response.json();
      
      if (!data || !data.items) {
        console.error("Invalid response format from Spotify API:", data);
        throw new Error("Invalid response format from Spotify API");
      }
      
      console.log(`Retrieved ${data.items.length} tracks from playlist ${playlistId} (offset ${offset})`);
      
      if (data.items && data.items.length > 0) {
        allTracks = allTracks.concat(data.items);
      }

      if (data.next && data.items.length === limit) {
        offset += limit;
      } else {
        hasMore = false;
      }
    }

    console.log(`Total tracks retrieved from playlist ${playlistId}: ${allTracks.length}`);
    
    return {
      items: allTracks,
      total: allTracks.length
    };
  } catch (error) {
    console.error(`Error fetching tracks for playlist ${playlistId}:`, error);
    throw error;
  }
}

export async function getTotalLikedSongsSpotify(request: Request): Promise<number> {
  const session = await getProviderSession(request, "spotify");
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

    // Create the output directory with the correct structure: tmp/userId/playlistName
    const outputDir = path.join(process.cwd(), "tmp", userId, playlistName);
    console.log(`Creating output directory: ${outputDir}`);
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
