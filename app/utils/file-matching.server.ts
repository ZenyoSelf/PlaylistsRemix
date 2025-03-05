import path from "path";
import fs from "fs/promises";

/**
 * Normalizes a string for comparison by converting to lowercase,
 * removing special characters, normalizing whitespace, and trimming.
 */
export function normalizeString(str: string): string {
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
export async function findMatchingFile(dirPath: string, songTitle: string, artistName?: string): Promise<string | null> {
  try {
    // Get all files in the directory
    const files = await fs.readdir(dirPath);
    
    // Normalize the song title for comparison
    const normalizedTitle = normalizeString(songTitle);
    const normalizedArtist = artistName ? normalizeString(artistName) : null;
    
    // First try: exact match with title
    const exactMatch = files.find(file => {
      const fileName = path.parse(file).name;
      return fileName.includes(songTitle);
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