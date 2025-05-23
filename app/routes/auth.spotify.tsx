import { redirect } from "@remix-run/node";
import type {  LoaderFunctionArgs } from "@remix-run/node";
import { authenticator } from "~/services/auth.server";


// This route is used to initiate the Spotify authentication flow
export async function loader({ request }: LoaderFunctionArgs) {
  // If the user is already authenticated, redirect to the account manager
  const user = await authenticator.isAuthenticated(request);
  if (user) {
    return redirect("/accountmanager");
  }
  
    // Initiate the Spotify authentication flow
    return authenticator.authenticate("spotify", request);
}
