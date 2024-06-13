import { LoaderFunctionArgs, json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import { Session } from "remix-auth-spotify";
import { ToastMessage } from "remix-toast";
import { spotifyStrategy } from "~/services/auth.server";
import { getUserSongs } from "~/services/supabase.server";
import { Song } from "~/types/customs";
import { toast as notify } from "sonner";
import { RiCheckLine } from "react-icons/ri";
import { FaDownload } from "react-icons/fa6";
interface LoaderData {
  session: Session | null;
  songs: Song[];
  messages: ToastMessage | null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  //Here handle all playlists and liked tracks
  //For now, only selected playlists
  const session = await spotifyStrategy.getSession(request);

  if (!session) {
    return json<LoaderData>({ session: null, songs: [], messages: null });
  }

  const userSongs = await getUserSongs(request);
  return json<LoaderData>({ session, songs: userSongs, messages: null });
}

export default function Updates() {
  const {
    session,
    songs: initialSongs,
    messages,
  } = useLoaderData<typeof loader>();
  const [songs, setSongs] = useState(initialSongs);

  const handleDl = async (song: Song) => {
    alert(song.title);
  };

  const handleRefresh = async () => {
    if (session) {
      const response = await fetch("/tracks/refresh", {
        method: "POST",
      });
      if (response.ok) {
        const data: { songs: Song[]; toast: ToastMessage } =
          await response.json();
        console.log("WEWEWE");
        console.log(data);
        setSongs(data.songs);
        if (data.toast.type == "success") {
          notify.success(data.toast.message);
        } else if (data.toast.type == "error") {
          notify.error(data.toast.message);
        }
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
                <button onClick={handleRefresh}>Refresh</button>
              </td>
              <td>
                <Form
                  action={session?.user ? "/logout" : "/auth/spotify"}
                  method="post"
                >
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
            <th>Downloaded ?</th>
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
              <td>
                {song.downloaded ? (
                  <RiCheckLine color="green" size={24} />
                ) : (
                  <FaDownload>
                    <button onClick={() => handleDl(song)}></button>
                  </FaDownload>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
