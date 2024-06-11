// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getAccessToken(clientId: string, code: string) {
  const verifier = localStorage.getItem("verifier");

  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("grant_type", "authorization_code");
  params.append("code", code);
  params.append("redirect_uri", "http://localhost:5173/callback");
  params.append("code_verifier", verifier!);

  const result = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  const { access_token } = await result.json();
  return access_token;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getLikedSongsSpotify(offset: number, limit: number) {
  const accessToken = "";
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
      ).then((r) => r.json());
    const data = await fetchLikedSongsTracks(limit, offset);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    likedSongs = likedSongs.concat(data.items); // Concatenate new songs to the existing list
    offset += limit; // Increment offset for pagination
    console.log(data);
  } catch (error) {
    console.error("Error fetching liked songs:", error);
  }
}
