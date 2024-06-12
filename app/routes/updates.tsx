import { LoaderFunctionArgs, TypedResponse } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Session } from "remix-auth-spotify";
import { spotifyStrategy } from "~/services/auth.server";

interface LoaderData {
  session: Session | null;
  spotifyLikedSongs:
    | TypedResponse<SpotifyApi.UsersSavedTracksResponse | undefined>
    | undefined;
}

export async function loader({ request }: LoaderFunctionArgs) {
  //Here handle all playlists and liked tracks
  //For now, only selected playlists
  const session = spotifyStrategy.getSession(request);

  return session;
  /* if (session == null) {
    const likedsongs = json(await getLikedSongsSpotify(0, 20));
    const data: LoaderData = {
      session: session,
      spotifyLikedSongs: likedsongs,
    };

    
  } else {
    const data: LoaderData = {
      session: null,
      spotifyLikedSongs: undefined,
    };
    return data;
  } */
}

export default function Updates() {
  const data = useLoaderData<typeof loader>();
  const user = data?.user;
  console.log(user);
  //const spotifyLikedSongs = data.spotifyLikedSongs;
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
                <Form action={"/tracks/refresh"} method="post">
                  {" "}
                  <button>Refresh</button>
                </Form>{" "}
              </td>{" "}
              <td>
                {" "}
                <Form action={user ? "/logout" : "/auth/spotify"} method="post">
                  {" "}
                  <button>
                    {user ? "Logout Spotify" : "Log in with Spotify"}
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
          <tr>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
