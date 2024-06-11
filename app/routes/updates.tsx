import { json, useLoaderData } from "@remix-run/react";

export async function loader() {
  //Here handle all playlists and liked tracks
  //For now, only selected playlists
  return json(await getLikedSongsSpotify(0, 20));
}

export default function Updates() {
  const data = useLoaderData<typeof loader>();
  return (
    <>
      <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.8" }}>
        <h1>Newest addition</h1>
      </div>

      <table>
        <thead>
          <th>Platform</th>
          <th>Title</th>
          <th>Artists</th>
          <th>Album</th>
          <th>Playlist</th>
        </thead>
        <tbody className="updates-body"></tbody>
      </table>
    </>
  );
}
