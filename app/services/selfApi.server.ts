import { execFile } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { convertSpotifyToYouTubeMusic } from "./spotToYt.server";
import fs from "fs/promises";
import { Song, SpotifyTrackItem, SpotifyTrack, SpotifyPlaylist } from "~/types/customs";
import { getProviderSession } from "./auth.server";
import { getUserPreferredFormat } from "./userPreferences.server";

/**
 * Convert FLAC file to AIFF using ffmpeg while preserving metadata
 */
async function convertFlacToAiff(flacFilePath: string): Promise<string> {
  const aiffFilePath = flacFilePath.replace(/\.flac$/i, '.aiff');
  const ffmpegPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../utils/ffmpeg");
  
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath,
      [
        '-i', flacFilePath,
        '-c:a', 'pcm_s16be', // Use PCM 16-bit big-endian for AIFF
        '-write_id3v2', '1', // Enable ID3v2 metadata writing for AIFF
        '-map_metadata', '0', // Copy all metadata
        '-map', '0:a', // Map audio stream
        '-map', '0:v?', // Map video/cover art if present (optional)
        '-y', // Overwrite output file if it exists
        aiffFilePath
      ],
      (error, stdout, stderr) => {
        if (error) {
          console.error(`ffmpeg conversion error: ${error.message}`);
          console.error(`ffmpeg stderr: ${stderr}`);
          reject(error);
        } else {
          console.log(`Successfully converted ${flacFilePath} to ${aiffFilePath}`);
          console.log(`ffmpeg stdout: ${stdout}`);
          console.log(`Metadata and album art should be preserved in AIFF file`);
          // Clean up the original FLAC file
          fs.unlink(flacFilePath).catch(err => 
            console.warn(`Could not delete original FLAC file: ${err.message}`)
          );
          resolve(aiffFilePath);
        }
      }
    );
  });
}

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
const ytDlpPath = path.resolve(__dirname, "../utils/yt-dlp");
const ffmpegPath = path.resolve(__dirname, "../utils/ffmpeg");

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
  console.log(`Finding matching file for: "${trackName}" by "${artists.join(', ')}"`);
  console.log(`Available files: ${JSON.stringify(files)}`);
  
  // Create variations of the expected filename
  const variations = [
    `${artists.join(",")} - ${trackName}`, // Original format
    trackName,                             // Just the track name
    normalizeFilename(`${artists.join(",")} - ${trackName}`), // Normalized version
  ];
  
  console.log(`Filename variations to search for: ${JSON.stringify(variations)}`);

  // Try exact matches first
  for (const file of files) {
    const fileWithoutExt = path.parse(file).name;
    if (variations.includes(fileWithoutExt)) {
      console.log(`Found exact match: "${file}"`);
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
      console.log(`Found normalized match: "${match.original}" for "${variation}"`);
      return match.original;
    }
  }
  
  // Try matching by keywords
  const keywords = normalizeFilename(trackName).split(' ').filter(word => word.length > 2);
  if (keywords.length > 0) {
    console.log(`Trying keyword matching with: ${JSON.stringify(keywords)}`);
    
    // Find files that contain most of the keywords
    const keywordMatches = normalizedFiles.map(file => ({
      file: file.original,
      matchCount: keywords.filter(keyword => file.normalized.includes(keyword)).length,
      matchRatio: keywords.filter(keyword => file.normalized.includes(keyword)).length / keywords.length
    }))
    .filter(match => match.matchRatio > 0.5) // At least 50% of keywords match
    .sort((a, b) => b.matchRatio - a.matchRatio); // Sort by match ratio descending
    
    if (keywordMatches.length > 0) {
      console.log(`Found keyword match: "${keywordMatches[0].file}" with match ratio ${keywordMatches[0].matchRatio}`);
      return keywordMatches[0].file;
    }
  }
  
  // If we still haven't found a match, try a more lenient approach
  // Just check if any file contains the first few characters of the track name
  if (trackName.length > 5) {
    const trackStart = normalizeFilename(trackName.substring(0, 5));
    const startMatch = normalizedFiles.find(file => file.normalized.includes(trackStart));
    if (startMatch) {
      console.log(`Found partial match by track name start: "${startMatch.original}"`);
      return startMatch.original;
    }
  }
  
  // If all else fails, just return the first file if there's only one
  if (files.length === 1) {
    console.log(`No match found, but only one file exists. Using: "${files[0]}"`);
    return files[0];
  }
  
  console.log(`No matching file found for: "${trackName}" by "${artists.join(', ')}"`);
  return undefined;
}

export async function downloadSpotifySong(
  trackName: string,
  artists: string[],
  playlistName: string,
  userId: string
): Promise<string> {
  try {
    console.log(`Starting download for: "${trackName}" by "${artists.join(", ")}" to playlist "${playlistName}"`);
    
    const song = await convertSpotifyToYouTubeMusic(trackName, artists);

    if (!song) {
      throw new Error(`Could not find YouTube video for: ${trackName} by ${artists.join(", ")}`);
    }

    // Get user's preferred format
    const userPreferredFormat = await getUserPreferredFormat(userId);
    console.log(`Using audio format: ${userPreferredFormat} for user ${userId}`);
    
    // Use FLAC for download if user wants AIFF (we'll convert after)
    const downloadFormat = userPreferredFormat === 'aiff' ? 'flac' : userPreferredFormat;

    // Create the output directory with the correct structure: tmp/userId/playlistName
    const outputDir = path.join(process.cwd(), "tmp", userId, playlistName);
    console.log(`Creating output directory: ${outputDir}`);
    await fs.mkdir(outputDir, { recursive: true });

    // Store original filename for Content-Disposition
    const originalFilename = `${artists.join(",")} - ${trackName}`;
    
    console.log(`Executing yt-dlp for: ${song.toString()}`);
    
    // Use consistent format for all downloads - no more NA prefix!
    const outputTemplate = `"%(artist)s - %(title)s.%(ext)s"`;
    
    const ytDlpCommand = [
      song.toString(),
      "-f", "bestaudio",
      "-x",
      "--audio-format", downloadFormat,
      "--audio-quality", "0",
      "--add-metadata",
      "--embed-thumbnail",
      "-o", outputTemplate,
      "-P", `"${outputDir}"`,
      "--ffmpeg-location", path.dirname(ffmpegPath),
      "--no-mtime",
    ];
    
    console.log(`yt-dlp command: ${ytDlpPath} ${ytDlpCommand.join(' ')}`);

    await new Promise((resolve, reject) => {
      execFile(
        ytDlpPath,
        ytDlpCommand,
        {
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
          shell: true
        },
        (error, stdout, stderr) => {
          if (error) {
            console.error(`yt-dlp error: ${error.message}`);
            console.error(`yt-dlp stderr: ${stderr}`);
            reject(error);
          } else {
            console.log(`yt-dlp stdout: ${stdout}`);
            resolve(stdout);
          }
        }
      );
    });

    // Add a delay to ensure file system operations are complete
    console.log(`Download completed, waiting for file system...`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get the downloaded file path with retry logic
    let files: string[] = [];
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      try {
        files = await fs.readdir(outputDir);
        if (files.length > 0) break;
        
        console.log(`No files found in ${outputDir}, retrying (${retryCount + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        retryCount++;
      } catch (error) {
        console.error(`Error reading directory ${outputDir}:`, error);
        if (retryCount >= maxRetries - 1) throw error;
        retryCount++;
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      }
    }
    
    if (files.length === 0) throw new Error(`No file was downloaded to ${outputDir} after ${maxRetries} attempts`);

    console.log(`Found ${files.length} files in directory: ${outputDir}`);
    console.log(`Available files:`, files);
    console.log(`Looking for track: "${trackName}" by "${artists.join(', ')}"`);
    
    // Try to find the downloaded file with retry logic
    let downloadedFile;
    retryCount = 0;
    
    while (retryCount < maxRetries && !downloadedFile) {
      downloadedFile = findMatchingFile(files, trackName, artists);
      if (downloadedFile) break;
      
      console.log(`File not found, retrying with delay (${retryCount + 1}/${maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Refresh the file list in case the file was still being written
      files = await fs.readdir(outputDir);
      retryCount++;
    }
    
    if (!downloadedFile) {
      throw new Error(`Could not find downloaded file for "${trackName}" by "${artists.join(', ')}" in ${outputDir}`);
    }

    let filePath = path.join(outputDir, downloadedFile);
    console.log(`File found: ${filePath}`);
    
    // Convert to AIFF if user requested AIFF format
    if (userPreferredFormat === 'aiff' && downloadedFile.toLowerCase().endsWith('.flac')) {
      console.log(`Converting FLAC to AIFF for user preference: ${filePath}`);
      filePath = await convertFlacToAiff(filePath);
      // Update the filename after conversion
      downloadedFile = path.basename(filePath);
    }
    
    // Return both the file path and original filename
    return JSON.stringify({
      path: filePath,
      originalName: originalFilename
    });

  } catch (error) {
    console.error(`Download process error for "${trackName}" by "${artists.join(', ')}":`, error);
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
