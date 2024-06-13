export interface Song {
  id: number;
  title: string | null;
  artists: string[] | null;
  album: string | null;
  playlist: string | null;
  platform: "Youtube" | "Spotify" | "Soundcloud";
  downloaded: boolean | null;
}
