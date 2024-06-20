import { searchMusics } from "node-youtube-music";

export async function convertSpotifyToYouTubeMusic(
  trackName: string,
  trackArtists: string[]
) {
  try {
    // Search for equivalent track on YouTube Music
    const searchQuery = `${trackName} ${trackArtists
      .map((artist) => artist)
      .join(" ")}`;
    console.log("Query : " + searchQuery);

    const ytSearchResults = await searchMusics(searchQuery);
    console.log("results : " + ytSearchResults.toString());
    if (ytSearchResults.length === 0) {
      throw new Error("Track not found on YouTube Music");
    }

    // Assume taking the first search result
    const firstResult = ytSearchResults[0];
    const ytMusicUrl = `https://music.youtube.com/watch?v=${firstResult.youtubeId}`;

    return ytMusicUrl;
  } catch (error) {
    console.error("Error converting Spotify URL to YouTube Music:", error);
    throw error;
  }
}
