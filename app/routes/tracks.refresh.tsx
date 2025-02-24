import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { jsonWithError, jsonWithSuccess } from "remix-toast";

import { getUserSongsFromDB, populateSongsForUser } from "~/services/db.server";
import { getTotalLikedSongsSpotify } from "~/services/selfApi.server";

export function loader() {
  return redirect("/updates");
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    // Get newest addition, then add to db
    await populateSongsForUser(request);

    // Then, get the updated songs from DB
    const userSongs = await getUserSongsFromDB(request, {
      page: 1,
      itemsPerPage: 10
    });

    // Get the total count
    const total = await getTotalLikedSongsSpotify(request);

    return jsonWithSuccess(
      {
        songs: userSongs.songs,
        total: total
      },
      "Successfully refreshed library"
    );

  } catch (error) {
    return jsonWithError(
      {
        songs: [],
        total: 0
      },
      error instanceof Error ? error.message : "Failed to sync library"
    );
  }
}
