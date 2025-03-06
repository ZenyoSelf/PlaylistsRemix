import { Song, YouTubePlaylist, YouTubePlaylistItem, YouTubePlaylistResponse, YouTubePlaylistsResponse } from "~/types/customs";

// YouTube API endpoints
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";



// Get all playlists for the authenticated user
export async function getAllUserPlaylistsYouTube(accessToken: string) {
  try {
    console.log("Starting to fetch YouTube playlists");
    const limit = 50; // Maximum limit allowed by YouTube API
    let pageToken = "";
    let allPlaylists: YouTubePlaylist[] = [];
    let hasMore = true;

    while (hasMore) {
      const url = `${YOUTUBE_API_BASE}/playlists?part=snippet,contentDetails&mine=true&maxResults=${limit}${
        pageToken ? `&pageToken=${pageToken}` : ""
      }`;
      
      console.log(`Fetching YouTube playlists with URL: ${url}`);
      console.log(`Using access token: ${accessToken.substring(0, 10)}...`);
      
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      console.log(`YouTube API response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`YouTube API error (${response.status}): ${errorText}`);
        throw new Error(`Failed to fetch playlists: ${response.statusText} (${response.status}). Details: ${errorText}`);
      }

      const data = await response.json() as YouTubePlaylistsResponse;
      console.log(`Retrieved ${data.items?.length || 0} YouTube playlists`);
      
      if (data.items && data.items.length > 0) {
        console.log("Playlist names:", data.items.map(p => p.snippet.title).join(", "));
        allPlaylists = allPlaylists.concat(data.items);
      } else {
        console.log("No playlists found in this page");
      }

      if (data.nextPageToken) {
        pageToken = data.nextPageToken;
        console.log(`Moving to next page with token: ${pageToken}`);
      } else {
        hasMore = false;
        console.log("No more pages to fetch");
      }
    }

    console.log(`Finished fetching YouTube playlists. Total: ${allPlaylists.length}`);
    return allPlaylists;
  } catch (error) {
    console.error("Error fetching YouTube playlists:", error);
    throw error;
  }
}

// Get all videos from a specific playlist
export async function getPlaylistVideosYouTube(accessToken: string, playlistId: string) {
  try {
    console.log(`Starting to fetch videos for YouTube playlist: ${playlistId}`);
    const limit = 50; // Maximum limit allowed by YouTube API
    let pageToken = "";
    let allItems: YouTubePlaylistItem[] = [];
    let hasMore = true;

    while (hasMore) {
      const url = `${YOUTUBE_API_BASE}/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=${limit}${
        pageToken ? `&pageToken=${pageToken}` : ""
      }`;
      
      console.log(`Fetching playlist items with URL: ${url}`);
      
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      console.log(`YouTube API response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`YouTube API error (${response.status}): ${errorText}`);
        throw new Error(`Failed to fetch playlist items: ${response.statusText} (${response.status}). Details: ${errorText}`);
      }

      const data = await response.json() as YouTubePlaylistResponse;
      console.log(`Retrieved ${data.items?.length || 0} videos from playlist`);
      
      if (data.items && data.items.length > 0) {
        allItems = allItems.concat(data.items);
      } else {
        console.log("No videos found in this page");
      }

      if (data.nextPageToken) {
        pageToken = data.nextPageToken;
        console.log(`Moving to next page with token: ${pageToken}`);
      } else {
        hasMore = false;
        console.log("No more pages to fetch");
      }
    }

    console.log(`Finished fetching playlist videos. Total: ${allItems.length}`);
    return allItems;
  } catch (error) {
    console.error("Error fetching playlist videos:", error);
    throw error;
  }
}

// Helper function to extract artist from YouTube video title
function extractArtistFromTitle(title: string, channelTitle: string): string[] {
  console.log(`Extracting artist from title: "${title}", channel: "${channelTitle}"`);
  
  // First, check if the channel is a "Topic" channel, which is the most reliable source
  if (channelTitle.includes(' - Topic')) {
    // For topic channels, the channel name without "- Topic" is the artist
    const artist = channelTitle.replace(' - Topic', '').trim();
    console.log(`Found topic channel, using artist: "${artist}"`);
    return [artist];
  }
  
  // Clean the title by removing common suffixes in parentheses that don't contain artist info
  let cleanedTitle = title;
  const parenthesesPatterns = [
    /\s*\(Official Video\)\s*$/i,
    /\s*\(Official Music Video\)\s*$/i,
    /\s*\(Official Audio\)\s*$/i,
    /\s*\(Official Lyric Video\)\s*$/i,
    /\s*\(Lyric Video\)\s*$/i,
    /\s*\(Audio\)\s*$/i,
    /\s*\(Visualizer\)\s*$/i,
    /\s*\(Performance Video\)\s*$/i,
    /\s*\(Official Performance Video\)\s*$/i,
    /\s*\(Official Visualizer\)\s*$/i,
    /\s*\(HD\)\s*$/i,
    /\s*\(HQ\)\s*$/i,
    /\s*\(4K\)\s*$/i,
  ];
  
  for (const pattern of parenthesesPatterns) {
    cleanedTitle = cleanedTitle.replace(pattern, '');
  }
  
  // Common patterns in music video titles
  const patterns = [
    // Artist - Title
    /^(.*?)\s*-\s*(.*?)$/,
    // Artist "Title"
    /^(.*?)\s*["'"](.*?)["'"]$/,
    // Artist : Title
    /^(.*?)\s*[:：]\s*(.*?)$/,
    // Artist | Title
    /^(.*?)\s*[|｜]\s*(.*?)$/,
    // Title by Artist
    /^(.*?)\s*by\s*(.*?)$/i,
    // Title - Artist
    /^(.*?)\s*-\s*(.*?)$/,
    // Title ft. Artist or Title feat. Artist
    /^(.*?)\s*(?:ft\.|feat\.)\s*(.*?)$/i,
  ];

  // Try each pattern on the cleaned title
  for (const pattern of patterns) {
    const match = cleanedTitle.match(pattern);
    if (match) {
      // Different handling based on pattern
      if (pattern.toString().includes('by\\s')) {
        // "Title by Artist" pattern - second group is the artist
        console.log(`Matched "Title by Artist" pattern, artist: "${match[2].trim()}"`);
        return [match[2].trim()];
      } else if (pattern.toString().includes('ft\\.|feat\\.')) {
        // "Title ft./feat. Artist" pattern - second group is the artist
        console.log(`Matched "Title ft./feat. Artist" pattern, artist: "${match[2].trim()}"`);
        return [match[2].trim()];
      } else {
        // For most patterns, first group is the artist
        console.log(`Matched standard pattern, artist: "${match[1].trim()}"`);
        return [match[1].trim()];
      }
    }
  }

  // Check if the title contains "ft." or "feat." but didn't match the patterns above
  const featMatch = cleanedTitle.match(/^(.*?)(?:\s*(?:ft\.|feat\.)\s*(.*?))?$/i);
  if (featMatch && featMatch[2]) {
    // If there's a featuring artist, use both the main artist (from channel) and featuring artist
    console.log(`Found featuring artist: "${featMatch[2].trim()}"`);
    return [channelTitle, featMatch[2].trim()];
  }

  // Check for titles with parentheses that might contain additional info but not the artist
  // For example: "Something About Us (Love Theme from Interstella 5555)"
  // In these cases, we should use the channel name if it's not a user account
  
  // Common user account patterns to avoid using as artist names
  const userAccountPatterns = [
    /^user\d+$/i,
    /^\w+\d+$/i,  // Words followed by numbers are often usernames
    /^[a-z0-9_]+$/i,  // Simple alphanumeric usernames
    /^populodaddy$/i,  // Specific case mentioned
    /^my\s*channel$/i,
    /^official\s*channel$/i,
  ];
  
  // Check if the channel title looks like a user account
  const isUserAccount = userAccountPatterns.some(pattern => 
    pattern.test(channelTitle.toLowerCase())
  );
  
  if (!isUserAccount) {
    console.log(`Channel doesn't look like a user account, using as artist: "${channelTitle}"`);
    return [channelTitle];
  }
  
  // If we get here, we couldn't extract a reliable artist name
  console.log(`Couldn't extract reliable artist, defaulting to "Unknown Artist"`);
  return ["Unknown Artist"];
}

// Convert YouTube playlist items to app Song format
export function convertYouTubeItemsToSongs(
  items: YouTubePlaylistItem[],
  playlistName: string
): Song[] {
  console.log(`Converting ${items.length} YouTube items from playlist "${playlistName}" to songs`);
  
  if (!items || items.length === 0) {
    console.log("No items to convert");
    return [];
  }
  
  const songs: Song[] = [];
  
  for (const item of items) {
    try {
      if (!item.snippet || !item.snippet.resourceId || !item.snippet.resourceId.videoId) {
        console.log("Skipping item without valid video ID:", item);
        continue;
      }
      
      const videoId = item.snippet.resourceId.videoId;
      const originalTitle = item.snippet.title;
      const channelTitle = item.snippet.videoOwnerChannelTitle;
      const thumbnailUrl = item.snippet.thumbnails.high?.url || 
                          item.snippet.thumbnails.medium?.url || 
                          item.snippet.thumbnails.default?.url || '';
      const publishedAt = item.snippet.publishedAt;
      
      // Extract artist information using our smart function
      const artists = extractArtistFromTitle(originalTitle, channelTitle);
      
      // Clean up the title
      let cleanTitle = originalTitle;
      
      // Remove common suffixes in parentheses
      const suffixesToRemove = [
        /\s*\(Official Video\)\s*$/i,
        /\s*\(Official Music Video\)\s*$/i,
        /\s*\(Official Audio\)\s*$/i,
        /\s*\(Official Lyric Video\)\s*$/i,
        /\s*\(Lyric Video\)\s*$/i,
        /\s*\(Audio\)\s*$/i,
        /\s*\(Visualizer\)\s*$/i,
        /\s*\(Performance Video\)\s*$/i,
        /\s*\(Official Performance Video\)\s*$/i,
        /\s*\(Official Visualizer\)\s*$/i,
        /\s*\(HD\)\s*$/i,
        /\s*\(HQ\)\s*$/i,
        /\s*\(4K\)\s*$/i,
      ];
      
      for (const pattern of suffixesToRemove) {
        cleanTitle = cleanTitle.replace(pattern, '');
      }
      
      // If we found an artist pattern, try to extract just the title part
      if (artists[0] !== channelTitle && artists[0] !== "Unknown Artist") {
        // Try to extract the title part based on common patterns
        const dashIndex = originalTitle.indexOf(' - ');
        if (dashIndex > 0) {
          // Assume format is "Artist - Title"
          cleanTitle = originalTitle.substring(dashIndex + 3).trim();
          
          // Also clean up any suffixes from the title
          for (const pattern of suffixesToRemove) {
            cleanTitle = cleanTitle.replace(pattern, '');
          }
        }
      }
      
      // Trim any extra whitespace
      cleanTitle = cleanTitle.trim();
      
      console.log(`Processed YouTube item: "${originalTitle}" → Title: "${cleanTitle}", Artist: "${artists.join(', ')}"`);
      
      // Create a song object from the YouTube item
      const song: Song = {
        id: 0, // This will be set by the database
        title: cleanTitle,
        artist_name: artists,
        album: playlistName,
        album_image: thumbnailUrl,
        playlist: [playlistName],
        platform: "Youtube",
        url: `https://www.youtube.com/watch?v=${videoId}`,
        downloaded: false,
        local: false,
        platform_added_at: publishedAt
      };
      
      songs.push(song);
    } catch (error) {
      console.error("Error converting YouTube item to song:", error, item);
    }
  }
  
  console.log(`Successfully converted ${songs.length} YouTube items to songs`);
  return songs;
}

// Get liked videos (requires additional permissions)
export async function getLikedVideosYouTube(accessToken: string) {
  try {
    const limit = 50;
    let pageToken = "";
    let allVideos: YouTubePlaylistItem[] = [];
    let hasMore = true;

    // YouTube stores liked videos in a special playlist with ID "LL"
    while (hasMore) {
      const url = `${YOUTUBE_API_BASE}/playlistItems?part=snippet&playlistId=LL&maxResults=${limit}${
        pageToken ? `&pageToken=${pageToken}` : ""
      }`;
      
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch liked videos: ${response.statusText}`);
      }

      const data = await response.json() as YouTubePlaylistResponse;
      allVideos = allVideos.concat(data.items);

      if (data.nextPageToken) {
        pageToken = data.nextPageToken;
      } else {
        hasMore = false;
      }
    }

    return allVideos;
  } catch (error) {
    console.error("Error fetching YouTube liked videos:", error);
    throw error;
  }
}

// Get details for a specific video
export async function getVideoDetails(accessToken: string, videoId: string) {
  try {
    console.log(`Fetching details for YouTube video: ${videoId}`);
    
    const url = `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails&id=${videoId}`;
    
    console.log(`Fetching video details with URL: ${url}`);
    
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    console.log(`YouTube API response status: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`YouTube API error (${response.status}): ${errorText}`);
      throw new Error(`Failed to fetch video details: ${response.statusText} (${response.status}). Details: ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.items || data.items.length === 0) {
      console.log(`No details found for video ${videoId}`);
      return null;
    }
    
    console.log(`Successfully fetched details for video ${videoId}`);
    return data.items[0];
  } catch (error) {
    console.error(`Error fetching video details for ${videoId}:`, error);
    return null;
  }
} 