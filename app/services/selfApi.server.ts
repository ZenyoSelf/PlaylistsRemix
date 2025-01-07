import { execFile } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import SpotifyApi from "spotify-web-api-node";
import { convertSpotifyToYouTubeMusic } from "./spotToYt.server";
import { Song } from "~/types/customs";
import { spotifyStrategy } from "./auth.server";

if (!process.env.SPOTIFY_CLIENT_ID) {
  throw new Error("Missing SPOTIFY_CLIENT_ID env");
}

if (!process.env.SPOTIFY_CLIENT_SECRET) {
  throw new Error("Missing SPOTIFY_CLIENT_SECRET env");
}

if (!process.env.SPOTIFY_CALLBACK_URL) {
  throw new Error("Missing SPOTIFY_CALLBACK_URL env");
}

// Use import.meta.url to get the current file URL and derive the directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Construct the path to the yt-dlp.exe executable
const ytDlpPath = path.resolve(__dirname, "../utils/yt-dlp.exe");

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getLikedSongsSpotify(
  offset: number,
  limit: number,
  accessToken: string
) {
  let likedSongs: unknown[] = [];

  try {
    const fetchLikedSongsTracks = (
      limit: number,
      offset: number
    ): Promise<SpotifyApi.UsersSavedTracksResponse> =>
      fetch(
        `https://api.spotify.com/v1/me/tracks?limit=${limit}&offset=${offset}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      ).then(async (r) => await r.json());

    const data = await fetchLikedSongsTracks(limit, offset);
    console.log(data);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    likedSongs = likedSongs.concat(data.items); // Concatenate new songs to the existing list
    offset += limit; // Increment offset for pagination
    return data;
  } catch (error) {
    console.error("Error fetching liked songs:", error);
  }
}


export async function getTotalLikedSongsSpotify(request: Request): Promise<number> {
  const session = await spotifyStrategy.getSession(request);
  if (!session) {
    throw new Error("No session established to spotify");
  }

  return fetch(
    `https://api.spotify.com/v1/me/tracks?limit=${0}&offset=${0}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${session?.accessToken}` },
    }
  ).then(async (r) => {
    const data = (await r.json()) as SpotifyApi.UsersSavedTracksResponse;
    return data.total
  }
  );

}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
/*
export async function getPlaylistsTracksSpotify(
  offset: number,
  limit: number,
  accessToken: string
) {
  let likedSongs: unknown[] = [];
  const sunset = "4K3GtjtO0hGzoySqSvvdBZ";
  const techdeeptech = "4ObXDAOjUuwcQbSebicdbk";
  const ukbass = "33eO98MoQVMjgdFrxOX0Qp";
  const th = "2Jr4dPvA1Tv2Hl6KJLFJI0";
  const mh = "260FBKvDzblBBE702GtUfp";

  const playlists = [];
  playlists.push(sunset);
  playlists.push(techdeeptech);
  playlists.push(ukbass);
  playlists.push(th);
  playlists.push(mh);
  try {
    const fetchPlaylistTracks = (
      playlistId: string
    ): Promise<SpotifyApi.PlaylistObjectFull> =>
      fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then(async (r) => await r.json());

    //Add all received tracks to supabase, basicly
    let allTracks: [] = [];
    playlists.forEach((playlistId) => {
      const data = fetchPlaylistTracks(playlistId);
      data.then((v) => {
        v.tracks.items.forEach((track) => {
          allTracks.push({
            id: track.track?.id,
          });
        });
      });
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    likedSongs = likedSongs.concat(data.items); // Concatenate new songs to the existing list
    offset += limit; // Increment offset for pagination
    return data;
  } catch (error) {
    console.error("Error fetching liked songs:", error);
  }
}
*/
export async function downloadSpotifySong(
  trackName: string,
  artists: string[],
  playlistName: string
) {
  console.log("starting dl..");
  const song = await convertSpotifyToYouTubeMusic(trackName, artists);

  if (song != null) {
    return new Promise((resolve, reject) => {
      execFile(
        ytDlpPath,
        [
          song.toString(),
          "-x",
          "--audio-format",
          "flac",
          "--parse-metadata",
          "title:%(artist)s - %(title)s",
          "-o",
          "public/" + playlistName + "/%(artist)s - %(title)s.%(ext)s",
        ],
        (error, stdout, stderr) => {
          if (error) {
            reject(`Error: ${error.message}`);
          } else if (stderr) {
            reject(`Stderr: ${stderr}`);
          } else {
            resolve(stdout);
          }
        }
      );
    });
  }
}
