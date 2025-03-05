import { ToastMessage } from "remix-toast";

export interface Song {
  id: number;
  title: string | null;
  artist_name: string[] | null;
  album_image: string | null;
  album: string | null;
  playlist: string[] | null;
  platform: "Youtube" | "Spotify" | "Soundcloud";
  platform_added_at: string;
  url: string;
  downloaded: boolean | null;
  local: boolean | null;
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
