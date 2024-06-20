import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { populateSongsForUser } from "~/services/supabase.server";
import { TracksRefresh } from "~/types/customs";
export function loader() {
  return redirect("/updates");
}

export async function action({
  request,
}: ActionFunctionArgs): Promise<TracksRefresh> {
  //Get newest addition, then add to db
  const songs = await populateSongsForUser(request);
  return {
    songs: songs,
    toast: { message: "Successfully refreshed", type: "success" },
  };
}
