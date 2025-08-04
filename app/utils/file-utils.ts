/**
 * Utility functions for file operations
 */

/**
 * Sanitize a string to be used as a file or directory name
 * Removes emojis, special characters, and other problematic characters
 * 
 * @param name The name to sanitize
 * @returns A sanitized name safe for file systems
 */
export function sanitizeFileName(name: string): string {
  if (!name) return 'unnamed';

  // Replace emojis and other non-ASCII characters
  const sanitized = name
    // Remove emojis and other non-ASCII characters using a function instead of regex
    .split('').filter(char => char.charCodeAt(0) <= 127).join('')
    // Replace characters that are problematic in file systems
    .replace(/[<>:"/\\|?*]/g, '_')
    // Replace multiple spaces/underscores with a single one
    .replace(/[\s_]+/g, ' ')
    // Trim spaces from start and end
    .trim();

  // If the sanitization removed everything, return a default name
  return sanitized || 'unnamed';
}

/**
 * Sanitize a playlist name for use as a directory name
 * 
 * @param playlistName The playlist name to sanitize
 * @returns A sanitized directory name
 */
export function sanitizeDirectoryName(playlistName: string): string {
  const sanitized = sanitizeFileName(playlistName);
  
  // If the name is empty after sanitization, use a default name
  if (!sanitized || sanitized === 'unnamed') {
    return 'default_playlist';
  }
  
  return sanitized;
} 