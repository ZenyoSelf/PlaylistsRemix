import { Song, YouTubePlaylist, YouTubePlaylistItem, YouTubePlaylistResponse, YouTubePlaylistsResponse } from "~/types/customs";

// YouTube API endpoints
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";



// Get all playlists for the authenticated user
export async function getAllUserPlaylistsYouTube(accessToken: string) {
  try {
    const limit = 50; // Maximum limit allowed by YouTube API
    let pageToken = "";
    let allPlaylists: YouTubePlaylist[] = [];
    let hasMore = true;

    while (hasMore) {
      const url = `${YOUTUBE_API_BASE}/playlists?part=snippet,contentDetails&mine=true&maxResults=${limit}${
        pageToken ? `&pageToken=${pageToken}` : ""
      }`;
      
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch playlists: ${response.statusText}`);
      }

      const data = await response.json() as YouTubePlaylistsResponse;
      allPlaylists = allPlaylists.concat(data.items);

      if (data.nextPageToken) {
        pageToken = data.nextPageToken;
      } else {
        hasMore = false;
      }
    }

    return allPlaylists;
  } catch (error) {
    console.error("Error fetching YouTube playlists:", error);
    throw error;
  }
}

// Get all videos from a specific playlist
export async function getPlaylistVideosYouTube(accessToken: string, playlistId: string) {
  try {
    const limit = 50; // Maximum limit allowed by YouTube API
    let pageToken = "";
    let allVideos: YouTubePlaylistItem[] = [];
    let hasMore = true;

    while (hasMore) {
      const url = `${YOUTUBE_API_BASE}/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=${limit}${
        pageToken ? `&pageToken=${pageToken}` : ""
      }`;
      
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch playlist videos: ${response.statusText}`);
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
    console.error("Error fetching YouTube playlist videos:", error);
    throw error;
  }
}

// Convert YouTube playlist items to app Song format
export function convertYouTubeItemsToSongs(
  items: YouTubePlaylistItem[],
  playlistName: string
): Song[] {
  return items.map((item) => {
    const videoId = item.snippet.resourceId.videoId;
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    return {
      id: 0, // This will be assigned by the database
      title: item.snippet.title,
      artist_name: [item.snippet.channelTitle],
      album: null,
      album_image: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
      playlist: [playlistName],
      platform: "Youtube",
      url: videoUrl,
      platform_added_at: item.snippet.publishedAt,
      downloaded: false,
      local: false
    };
  });
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