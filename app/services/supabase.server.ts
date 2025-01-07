import { createClient } from "@supabase/supabase-js";
import { spotifyStrategy } from "./auth.server";
import { getLikedSongsSpotify } from "./selfApi.server";
import { Song } from "~/types/customs";

const supabaseUrl = "https://yukhjxbymehlnclhrehl.supabase.co";
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseKey) {
  throw new Error("Missing SUPABASE_KEY env");
}
const supabase = createClient(supabaseUrl, supabaseKey);

export async function getSongs(userUUID: string) {
  const { data: song, error } = await supabase
    .from("song")
    .select("*")
    .filter("user", userUUID, "eq");
  if (error) return error;
  return song;
}

export async function getLatestRefresh(email: string) {
  const { data, error } = await supabase
    .from("user")
    .select("last_refresh")
    .eq("user", email)
    .single();
  if (error) {
    throw new Error("getLatestRefresh error");
  } else {
    return data.last_refresh;
  }
}

export async function getUserSongs(request: Request): Promise<Song[]> {
  const session = await spotifyStrategy.getSession(request);
  if (!session) {
    throw new Error("No session established to spotify");
  }
  const { data, error } = await supabase
    .from("song")
    .select("*")
    .eq("user", session.user!.email);
  if (error) {
    console.error("Error fetching songs from Supabase:", error);
    return [];
  }
  return data.map((item) => ({
    id: item.id,
    title: item.title,
    artists: item.artist_name,
    album: item.album,
    playlist: item.playlist,
    platform: item.platform,
    url: item.url,
    downloaded: item.downloaded,
    platform_added_at: item.platform_added_at,
  }));
}

export async function populateSongsForUser(request: Request) {
  const session = await spotifyStrategy.getSession(request);
  if (!session) {
    throw new Error("No session established to spotify");
  }
  const likedsongs = await getLikedSongsSpotify(0, 20, session?.accessToken);

  const latestRefresh = await getLatestRefresh(session.user!.email);

  const items = likedsongs?.items.filter(
    (t) => new Date(t.added_at) > new Date(latestRefresh)
  );
  if (items && items.length > 0) {
    const dataInsert: unknown[] = [];

    items.forEach((item) => {
      const artist_name = item.track.artists.map((t) => t.name);
      dataInsert.push({
        artist_name: artist_name,
        downloaded: false,
        title: item.track.name,
        album: item.track.album.name,
        user: session.user?.email,
        playlist: "SpotifyLikedSongs",
        platform: "Spotify",
        url: item.track.uri,
        platform_added_at: new Date(item.added_at).toISOString(),
      });
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { data: dataInsertResponse, error: dataInsertError } = await supabase
      .from("song")
      .insert(dataInsert)
      .select();
    if (dataInsertError != null) {
      console.log(dataInsertError);
      throw new Error("Error during inserting new songs");
    }

    const currentDatetimeZ = new Date().toISOString().toLocaleString();
    const { error: ErrorDateTimeZ } = await supabase
      .from("user")
      .update({ last_refresh: currentDatetimeZ })
      .eq("user", session.user?.email);
    if (ErrorDateTimeZ != null)
      throw new Error("Error during updating new last_refresh");
  }
  const userSongs = await getUserSongs(request);
  return userSongs;
}
