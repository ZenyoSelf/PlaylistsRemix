import { ToastMessage } from "remix-toast";

export interface Song {
  id: number;
  title: string | null;
  artist_name: string[] | null;
  album_image: string | null;
  album: string | null;
  platform: "Youtube" | "Spotify" | "Soundcloud";
  platform_added_at: string;
  url: string;
  downloaded: boolean | null;
  local: boolean | null;
  playlists?: Playlist[];
  playlist?: string[] | null;
}

export interface Playlist {
  id: number;
  platform_playlist_id: string;
  name: string;
  platform: string;
  owner_id: string | null;
  user: string;
  added_at?: string;
}

export interface SongPlaylist {
  song_id: number;
  playlist_id: number;
  added_at: string;
}

export interface TracksRefresh {
  songs: Song[];
  toast: ToastMessage;
  total:number;
}

// Spotify API interfaces
export interface SpotifyTrackItem {
  track: {
    id: string;
    name: string;
    uri: string;
    artists: Array<{ name: string }>;
    album: {
      name: string;
      images: Array<{ url: string; height: number; width: number }>;
    };
  };
  added_at: string;
}

export interface SpotifyTrack {
  total: number;
  items: SpotifyTrackItem[];
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  images: Array<{ url: string; height: number; width: number }>;
  tracks: {
    total: number;
    href: string;
  };
  owner: {
    display_name: string;
    id: string;
  };
  public: boolean;
  collaborative: boolean;
  href: string;
  uri: string;
}

// YouTube API interfaces
export interface YouTubeTrackItem {
  id: string;
  snippet: {
    publishedAt: string;
    title: string;
    description: string;
    thumbnails: {
      default: { url: string; width: number; height: number };
      medium: { url: string; width: number; height: number };
      high: { url: string; width: number; height: number };
      standard?: { url: string; width: number; height: number };
      maxres?: { url: string; width: number; height: number };
    };
    channelTitle: string;
    playlistId: string;
    position: number;
    resourceId: {
      kind: string;
      videoId: string;
    };
  };
}


// Interface for YouTube playlist items
export interface YouTubePlaylistItem {
  id: string;
  snippet: {
    videoOwnerChannelTitle: string;
    publishedAt: string;
    title: string;
    description: string;
    thumbnails: {
      default: { url: string; width: number; height: number };
      medium: { url: string; width: number; height: number };
      high: { url: string; width: number; height: number };
      standard?: { url: string; width: number; height: number };
      maxres?: { url: string; width: number; height: number };
    };
    channelTitle: string;
    playlistId: string;
    position: number;
    resourceId: {
      kind: string;
      videoId: string;
    };
  };
}

// Interface for YouTube playlist response
export interface YouTubePlaylistResponse {
  kind: string;
  etag: string;
  nextPageToken?: string;
  prevPageToken?: string;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
  items: YouTubePlaylistItem[];
}

// Interface for YouTube playlist details
export interface YouTubePlaylist {
  id: string;
  snippet: {
    title: string;
    description: string;
    thumbnails: {
      default: { url: string; width: number; height: number };
      medium: { url: string; width: number; height: number };
      high: { url: string; width: number; height: number };
      standard?: { url: string; width: number; height: number };
      maxres?: { url: string; width: number; height: number };
    };
    channelTitle: string;
  };
  contentDetails: {
    itemCount: number;
  };
}

// Interface for YouTube playlists response
export interface YouTubePlaylistsResponse {
  kind: string;
  etag: string;
  nextPageToken?: string;
  prevPageToken?: string;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
  items: YouTubePlaylist[];
}