import { createClient } from "@supabase/supabase-js";
import { spotifyStrategy } from "./auth.server";
import { getLikedSongsSpotify } from "./selfApi.server";

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
    .filter("user", "eq", email);
  if (error) {
    console.log(error);
    throw new Error("getLatestRefresh error");
  } else {
    return data;
  }
}

export async function populateSongsForUser(request: Request) {
  const session = await spotifyStrategy.getSession(request);
  if (!session) {
    throw new Error("No session established to spotify");
  }
  const likedsongs = await getLikedSongsSpotify(0, 20, session?.accessToken);

  const latestRefresh = await getLatestRefresh(session.user!.email);

  const dataInsert: unknown[] = [];
  likedsongs?.items.forEach((item) => {
    const artist_name = item.track.artists.map((t) => t.name);
    console.log(item.added_at);
    //2024-06-12T19:19:52.167887+00:00
    dataInsert.push({
      artist_name: artist_name,
      downloaded: false,
      title: item.track.name,
      album: item.track.album.name,
      user: session.user?.email,
      playlist: "SpotifyLikedSongs",
      platform: "Spotify",
      platform_added_at: item.added_at,
    });
  });

  const { data, error } = await supabase
    .from("song")
    .insert(dataInsert)
    .select();
  if (error != null) console.log(error);

  return data;
}
