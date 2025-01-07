import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { populateSongsForUser } from "~/services/db.server";
import { getTotalLikedSongsSpotify } from "~/services/selfApi.server";
import { TracksRefresh } from "~/types/customs";

export function loader() {
  return redirect("/updates");
}

export async function action({
  request,
}: ActionFunctionArgs): Promise<TracksRefresh> {
  //Get newest addition, then add to db
  const songs = await populateSongsForUser(request);
  const total = await getTotalLikedSongsSpotify(request);
  return {
    songs: songs,
    total:total,
    toast: { message: "Successfully refreshed", type: "success" },
  };
}
