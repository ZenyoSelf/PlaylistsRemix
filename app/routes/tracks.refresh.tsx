import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import { populateSongsForUser } from "~/services/supabase.server";

export function loader() {
  return redirect("/updates");
}

export async function action({ request }: ActionFunctionArgs) {
  //Get newest addition, then add to db
  return populateSongsForUser(request);
}
