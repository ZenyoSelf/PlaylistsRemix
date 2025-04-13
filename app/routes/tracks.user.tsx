import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { getUserSongsFromDB } from "~/services/db.server";

export function loader() {
  return redirect("/updates");
}

export async function action({ request }: ActionFunctionArgs) {
  //Get rows of song from user, for now only works with spotify email (as no coorelation).
  const songs = getUserSongsFromDB(request);
  return songs;
}
