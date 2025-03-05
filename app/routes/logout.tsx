import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { sessionStorage, SPOTIFY_SESSION_KEY, YOUTUBE_SESSION_KEY } from "~/services/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Clear both sessions
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  session.unset(SPOTIFY_SESSION_KEY);
  session.unset(YOUTUBE_SESSION_KEY); // Default session key for YouTube
  
  return redirect("/", {
    headers: {
      "Set-Cookie": await sessionStorage.commitSession(session)
    }
  });
}

export async function action({ request }: ActionFunctionArgs) {
  // Clear both sessions
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  session.unset(SPOTIFY_SESSION_KEY);
  session.unset(YOUTUBE_SESSION_KEY); // Default session key for YouTube
  
  return redirect("/", {
    headers: {
      "Set-Cookie": await sessionStorage.commitSession(session)
    }
  });
}
