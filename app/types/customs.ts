import { ToastMessage } from "remix-toast";

export interface Song {
  id: number;
  title: string | null;
  artist_name: string[] | null;
  album_image: string | null;
  album: string | null;
  playlist: string | null;
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
