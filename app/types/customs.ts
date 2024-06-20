import { ToastMessage } from "remix-toast";

export interface Song {
  id: number;
  title: string | null;
  artists: string[] | null;
  album: string | null;
  playlist: string | null;
  platform: "Youtube" | "Spotify" | "Soundcloud";
  url: string;
  downloaded: boolean | null;
}

export interface TracksRefresh {
  songs: Song[];
  toast: ToastMessage;
}
