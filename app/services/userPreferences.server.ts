import { getDb } from "./db.server";

/**
 * Get user's preferred file format
 * @param userId User ID
 * @returns Preferred file format (defaults to 'flac' if not set)
 */
export async function getUserPreferredFormat(userId: number | string): Promise<string> {
  const db = await getDb();
  try {
    // Convert userId to number if it's a string
    const userIdNum = typeof userId === 'string' ? parseInt(userId, 10) : userId;
    
    // Get user's preferred format
    const result = await db.get(
      "SELECT file_format FROM user_preferences WHERE user_id = ?",
      [userIdNum]
    );

    // Return the preferred format or default to 'flac'
    return result?.file_format || 'flac';
  } catch (error) {
    console.error("Error getting user preferred format:", error);
    return 'flac'; // Default to flac on error
  } finally {
    await db.close();
  }
}

/**
 * Set user's preferred file format
 * @param userId User ID
 * @param format Preferred file format
 * @returns Success status
 */
export async function setUserPreferredFormat(userId: number | string, format: string): Promise<boolean> {
  const db = await getDb();
  try {
    // Convert userId to number if it's a string
    const userIdNum = typeof userId === 'string' ? parseInt(userId, 10) : userId;
    
    // Validate format
    const validFormats = ['flac', 'mp3', 'wav', 'aiff', 'm4a'];
    const safeFormat = validFormats.includes(format) ? format : 'flac';
    
    // Update or insert user preference
    await db.run(
      `INSERT INTO user_preferences (user_id, file_format, updated_at) 
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) 
       DO UPDATE SET file_format = ?, updated_at = CURRENT_TIMESTAMP`,
      [userIdNum, safeFormat, safeFormat]
    );
    
    return true;
  } catch (error) {
    console.error("Error setting user preferred format:", error);
    return false;
  } finally {
    await db.close();
  }
} 