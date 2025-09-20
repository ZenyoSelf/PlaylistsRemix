import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { Song } from "~/types/customs";
import { getUserPreferredFormat } from "./userPreferences.server";

// Construct __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ytDlpPath = path.resolve(__dirname, "../utils/yt-dlp");
const ffmpegPath = path.resolve(__dirname, "../utils/ffmpeg");

/**
 * Convert FLAC file to AIFF using ffmpeg while preserving metadata
 */
async function convertFlacToAiff(flacFilePath: string): Promise<string> {
  const aiffFilePath = flacFilePath.replace(/\.flac$/i, '.aiff');
  
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

export async function downloadYouTubeVideo(
  videoUrl: string,
  outputDir: string,
  userId: string,
  format?: string
): Promise<string> {
  try {
    // Get user's preferred format if not provided
    const userPreferredFormat = format || await getUserPreferredFormat(userId);
    
    // Use FLAC for download if user wants AIFF (we'll convert after)
    const downloadFormat = userPreferredFormat === 'aiff' ? 'flac' : userPreferredFormat;
    
    // Create user directory if it doesn't exist
    const userDir = path.join(outputDir, userId);
    await fs.mkdir(userDir, { recursive: true });
    
    // Set output template for the downloaded file (title only to avoid NA prefix)
    const outputTemplate = path.join(userDir, "%(title)s.%(ext)s");
    
    // Execute yt-dlp to download the video
    await new Promise<void>((resolve, reject) => {
      execFile(
        ytDlpPath,
        [
          videoUrl,
          "-f", "bestaudio",
          "-x",
          "--audio-format", downloadFormat,
          "--audio-quality", "0",
          "--add-metadata",
          "--embed-thumbnail",
          "--output-na-placeholder", "Unknown",
          "-o", `"${outputTemplate}"`,
          "--ffmpeg-location", path.dirname(ffmpegPath),
          "--no-mtime",
        ],
        {
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
          shell: true
        },
        (error) => {
          if (error) reject(error);
          else resolve();
        }
      );
    });

    // Get the downloaded file path
    const files = await fs.readdir(userDir);
    if (files.length === 0) throw new Error("No file was downloaded");

    // Get the most recently created file
    const fileStat = await Promise.all(
      files.map(async (file) => {
        const stats = await fs.stat(path.join(userDir, file));
        return { file, stats };
      })
    );
    
    fileStat.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
    
    if (fileStat.length === 0) {
      throw new Error("Could not find downloaded file");
    }

    const downloadedFile = fileStat[0].file;
    let filePath = path.join(userDir, downloadedFile);
    
    // Convert to AIFF if user requested AIFF format
    if (userPreferredFormat === 'aiff' && downloadedFile.toLowerCase().endsWith('.flac')) {
      console.log(`Converting FLAC to AIFF for user preference: ${filePath}`);
      filePath = await convertFlacToAiff(filePath);
    }
    
    return filePath;
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


/**
 * Download audio from a custom URL using yt-dlp
 * This supports any URL that yt-dlp supports (YouTube, SoundCloud, Bandcamp, etc.)
 */
export async function downloadFromCustomUrl(
  url: string,
  outputDir: string,
  userId: string,
  playlistName: string = "custom",
  format?: string
): Promise<{ path: string; originalName: string }> {
  try {
    // Get user's preferred format if not provided
    const userPreferredFormat = format || await getUserPreferredFormat(userId);
    
    // Use FLAC for download if user wants AIFF (we'll convert after)
    const downloadFormat = userPreferredFormat === 'aiff' ? 'flac' : userPreferredFormat;
    
    // Create user directory if it doesn't exist
    const userDir = path.join(outputDir, userId, playlistName);
    await fs.mkdir(userDir, { recursive: true });
    
    // Set output template for the downloaded file
    const outputTemplate = path.join(userDir, "%(artist)s - %(title)s.%(ext)s");
    
    // Execute yt-dlp to download the audio
    await new Promise<void>((resolve, reject) => {
      execFile(
        ytDlpPath,
        [
          url,
          "-f", "bestaudio",
          "-x",
          "--audio-format", downloadFormat,
          "--audio-quality", "0",
          "--add-metadata",
          "--embed-thumbnail",
          "--output-na-placeholder", "Unknown",
          "-o", `"${outputTemplate}"`,
          "--ffmpeg-location", path.dirname(ffmpegPath),
          "--no-mtime",
        ],
        {
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
          shell: true
        },
        (error) => {
          if (error) reject(error);
          else resolve();
        }
      );
    });

    // Get the downloaded file path
    const files = await fs.readdir(userDir);
    if (files.length === 0) throw new Error("No file was downloaded");

    // Get the most recently created file
    const fileStat = await Promise.all(
      files.map(async (file) => {
        const stats = await fs.stat(path.join(userDir, file));
        return { file, stats };
      })
    );
    
    fileStat.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
    
    if (fileStat.length === 0) {
      throw new Error("Could not find downloaded file");
    }

    const downloadedFile = fileStat[0].file;
    let filePath = path.join(userDir, downloadedFile);
    let finalFileName = downloadedFile;
    
    // Convert to AIFF if user requested AIFF format
    if (userPreferredFormat === 'aiff' && downloadedFile.toLowerCase().endsWith('.flac')) {
      console.log(`Converting FLAC to AIFF for user preference: ${filePath}`);
      filePath = await convertFlacToAiff(filePath);
      finalFileName = path.basename(filePath);
    }
    
    return {
      path: filePath,
      originalName: finalFileName
    };
  } catch (error) {
    console.error("Error downloading from custom URL:", error);
    throw error;
  }
}

/**
 * Extract metadata from a URL using yt-dlp
 * Returns title, artist, and thumbnail URL
 */
export async function getMetadataFromUrl(url: string): Promise<{
  title: string;
  artist: string[];
  thumbnailUrl: string;
  platform: string;
}> {
  try {
    // Execute yt-dlp to get metadata
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        ytDlpPath,
        [
          url,
          "--dump-json",
          "--no-playlist",
          "--no-warnings",
          "--quiet"
        ],
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        }
      );
    });

    const metadata = JSON.parse(output);
    
    // Extract platform from extractor_key
    let platform = "Unknown";
    if (metadata.extractor_key) {
      platform = metadata.extractor_key.replace("IE", "");
    } else if (metadata.extractor) {
      platform = metadata.extractor.split(':')[0];
    }
    
    // Extract artist(s)
    let artists: string[] = [];
    if (metadata.artist) {
      artists = Array.isArray(metadata.artist) ? metadata.artist : [metadata.artist];
    } else if (metadata.uploader) {
      artists = [metadata.uploader];
    } else if (metadata.channel) {
      artists = [metadata.channel];
    }
    
    // If no artists found, use "Unknown Artist"
    if (artists.length === 0) {
      artists = ["Unknown Artist"];
    }
    
    // Extract thumbnail URL
    let thumbnailUrl = "";
    if (metadata.thumbnail) {
      thumbnailUrl = metadata.thumbnail;
    } else if (metadata.thumbnails && metadata.thumbnails.length > 0) {
      // Get the largest thumbnail
      const sortedThumbnails = [...metadata.thumbnails].sort((a, b) => {
        const aSize = (a.width || 0) * (a.height || 0);
        const bSize = (b.width || 0) * (b.height || 0);
        return bSize - aSize;
      });
      thumbnailUrl = sortedThumbnails[0].url;
    }
    
    return {
      title: metadata.title || "Unknown Title",
      artist: artists,
      thumbnailUrl,
      platform
    };
  } catch (error) {
    console.error("Error getting metadata from URL:", error);
    throw error;
  }
} 