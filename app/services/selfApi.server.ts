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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    likedSongs = likedSongs.concat(data.items); // Concatenate new songs to the existing list
    offset += limit; // Increment offset for pagination
    return data;
  } catch (error) {
    console.error("Error fetching liked songs:", error);
  }
}
