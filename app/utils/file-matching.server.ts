import path from "path";
import fs from "fs/promises";

// Helper function to add delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Normalizes a string for comparison by converting to lowercase,
 * removing special characters, normalizing whitespace, and trimming.
 */
export function normalizeString(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim();
}

/**
 * Finds a file in a directory that best matches a song title and optionally artist name.
 * Uses multiple matching strategies with decreasing strictness.
 */
export async function findMatchingFile(dirPath: string, songTitle: string | undefined, artistName?: string): Promise<string | null> {
  try {
    // Add a small delay to throttle file system operations
    await delay(50);
    
    // Get all files in the directory
    let files: string[] = [];
    try {
      files = await fs.readdir(dirPath);
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error);
      return null;
    }
    
    if (files.length === 0) {
      return null;
    }
    
    // Normalize the song title for comparison
    const normalizedTitle = normalizeString(songTitle || '');
    const normalizedArtist = artistName ? normalizeString(artistName) : null;
    
    if (!normalizedTitle) {
      return null;
    }
    
    // First try: exact match with title
    const exactMatch = files.find(file => {
      const fileName = path.parse(file).name;
      return fileName.includes(songTitle || '');
    });
    
    if (exactMatch) return exactMatch;
    
    // Second try: normalized match with title
    const normalizedMatch = files.find(file => {
      const fileName = normalizeString(path.parse(file).name);
      return fileName.includes(normalizedTitle);
    });
    
    if (normalizedMatch) return normalizedMatch;
    
    // Third try: check if title keywords are in the filename
    const titleKeywords = normalizedTitle.split(' ').filter(word => word.length > 2);
    
    if (titleKeywords.length === 0) {
      return null;
    }
    
    const keywordMatch = files.find(file => {
      const fileName = normalizeString(path.parse(file).name);
      // Check if most of the keywords are in the filename
      const matchingKeywords = titleKeywords.filter(keyword => fileName.includes(keyword));
      return matchingKeywords.length >= Math.ceil(titleKeywords.length * 0.7); // 70% of keywords match
    });
    
    if (keywordMatch) return keywordMatch;
    
    // Fourth try: if we have artist name, check if both artist and part of title are in filename
    if (normalizedArtist) {
      const artistAndTitleMatch = files.find(file => {
        const fileName = normalizeString(path.parse(file).name);
        return fileName.includes(normalizedArtist) && 
               titleKeywords.some(keyword => fileName.includes(keyword));
      });
      
      if (artistAndTitleMatch) return artistAndTitleMatch;
    }
    
    return null;
  } catch (error) {
    console.error("Error finding matching file:", error);
    return null;
  }
} 