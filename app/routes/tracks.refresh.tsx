import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { getUserSongsFromDB, populateSongsForUser } from "~/services/db.server";
import { getTotalLikedSongsSpotify } from "~/services/selfApi.server";
import { TracksRefresh } from "~/types/customs";

export function loader() {
  return redirect("/updates");
}

export async function action({
  request,
}: ActionFunctionArgs): Promise<TracksRefresh> {
  //Get newest addition, then add to db
  // First, populate songs from Spotify API to DB
  await populateSongsForUser(request);

  // Then, get the updated songs from DB
  const userSongs = await getUserSongsFromDB(request, 10);

  // Get the total count
  const total = await getTotalLikedSongsSpotify(request);
  return {
    songs: userSongs,
    total: total,
    toast: { message: "Successfully refreshed", type: "success" },
  };
}
