import { LoaderFunction, json } from "@remix-run/node";
import { getDb } from "~/services/db.server";
import { getProviderSession } from "~/services/auth.server";

export const loader: LoaderFunction = async ({ request }) => {
  try {
    // Get user sessions
    const spotifySession = await getProviderSession(request, "spotify");
    const youtubeSession = await getProviderSession(request, "youtube");
    
    // Get emails from both sessions if available
    const spotifyEmail = spotifySession?.email || '';
    const youtubeEmail = youtubeSession?.email || '';
    
    // Check if at least one provider is authenticated
    if (!spotifyEmail && !youtubeEmail) {
      return json({ error: "User not authenticated with any provider" }, { status: 401 });
    }
    
    const db = await getDb();
    
    // Get all platforms in the database
    const allPlatformsQuery = await db.all("SELECT DISTINCT platform FROM song");
    const allPlatforms = allPlatformsQuery.map(p => p.platform);
    
    // Get platforms for Spotify user
    let spotifyPlatforms = [];
    if (spotifyEmail) {
      const spotifyPlatformsQuery = await db.all(
        "SELECT DISTINCT platform FROM song WHERE user = ?",
        [spotifyEmail]
      );
      spotifyPlatforms = spotifyPlatformsQuery.map(p => p.platform);
    }
    
    // Get platforms for YouTube user
    let youtubePlatforms = [];
    if (youtubeEmail) {
      const youtubePlatformsQuery = await db.all(
        "SELECT DISTINCT platform FROM song WHERE user = ?",
        [youtubeEmail]
      );
      youtubePlatforms = youtubePlatformsQuery.map(p => p.platform);
    }
    
    // Get song counts by platform
    const songCountsByPlatform = await db.all(`
      SELECT platform, COUNT(*) as count 
      FROM song 
      WHERE user IN (${spotifyEmail ? '?' : ''} ${spotifyEmail && youtubeEmail ? ',' : ''} ${youtubeEmail ? '?' : ''})
      GROUP BY platform
    `, [
      ...(spotifyEmail ? [spotifyEmail] : []),
      ...(youtubeEmail ? [youtubeEmail] : [])
    ]);
    
    // Get user information
    const userInfo = {
      spotifyEmail,
      youtubeEmail,
      spotifyAuthenticated: !!spotifySession,
      youtubeAuthenticated: !!youtubeSession
    };
    
    return json({
      userInfo,
      allPlatforms,
      spotifyPlatforms,
      youtubePlatforms,
      songCountsByPlatform
    });
  } catch (error) {
    console.error("Debug API error:", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}; 