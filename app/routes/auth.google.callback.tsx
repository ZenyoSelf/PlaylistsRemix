import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticator, sessionStorage, YOUTUBE_SESSION_KEY } from "~/services/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  // Authenticate with the YouTube strategy
  const user = await authenticator.authenticate("youtube", request, {
    failureRedirect: "/accountmanager",
  });

   // Get the session and ensure the user data is stored in the SPOTIFY_SESSION_KEY
   const session = await sessionStorage.getSession(request.headers.get("Cookie"));
   session.set(YOUTUBE_SESSION_KEY, user);
   
   // Redirect to the account manager with the updated session
   return redirect("/accountmanager", {
     headers: {
       "Set-Cookie": await sessionStorage.commitSession(session),
     },
   });
} 