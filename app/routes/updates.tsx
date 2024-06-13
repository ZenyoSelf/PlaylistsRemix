import { LoaderFunctionArgs, json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import { Session } from "remix-auth-spotify";
import { spotifyStrategy } from "~/services/auth.server";
import { getUserSongs } from "~/services/supabase.server";
import { Song } from "~/types/customs";

interface LoaderData {
  session: Session | null;
  songs: Song[];
}

export async function loader({ request }: LoaderFunctionArgs) {
  //Here handle all playlists and liked tracks
  //For now, only selected playlists
  const session = await spotifyStrategy.getSession(request);

  if (!session) {
    return json<LoaderData>({ session: null, songs: [] });
  }

  const userSongs = await getUserSongs(request);
  return json<LoaderData>({ session, songs: userSongs });
}

export default function Updates() {
  const { session, songs: initialSongs } = useLoaderData<typeof loader>();
  const [songs, setSongs] = useState(initialSongs);

  const handleRefresh = async () => {
    if (session) {
      const response = await fetch("/tracks/refresh", {
        method: "POST",
      });
      if (response.ok) {
        const data: { songs: Song[] } = await response.json();
        console.log("WEWEWE");
        console.log(data);
        setSongs(data.songs);
      }
    }
  };

  return (
    <>
      <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.8" }}>
        <h1>Newest addition</h1>
      </div>
      <div>
        <table>
          <tbody>
            <tr>
              <td>
                {" "}
                <button onClick={handleRefresh}>Refresh</button>
              </td>{" "}
              <td>
                {" "}
                <Form
                  action={session?.user ? "/logout" : "/auth/spotify"}
                  method="post"
                >
                  {" "}
                  <button>
                    {session?.user ? "Logout Spotify" : "Log in with Spotify"}
                  </button>
                </Form>
              </td>
              <td>
                <button>Connect with Youtube Music</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <table>
        <thead>
          <tr>
            <th>Platform</th>
            <th>Title</th>
            <th>Artists</th>
            <th>Album</th>
            <th>Playlist</th>
          </tr>
        </thead>
        <tbody>
          {songs.map((song) => (
            <tr key={song.id}>
              <td>{song.platform}</td>
              <td>{song.title}</td>
              <td>{song.artists?.join(", ")}</td>
              <td>{song.album}</td>
              <td>{song.playlist}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
