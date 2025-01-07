import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { getUserSongs } from "~/services/db.server";

export function loader() {
  return redirect("/updates");
}

export async function action({ request }: ActionFunctionArgs) {
  //Get rows of song from user, for now only works with spotify email (as no coorelation).
  const songs = getUserSongs(request);
  return songs;
}
