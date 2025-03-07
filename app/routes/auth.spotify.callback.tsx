import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticator, sessionStorage, SPOTIFY_SESSION_KEY } from "~/services/auth.server";
import { getDb } from "~/services/db.server";

// Define the type for the Spotify user
interface SpotifyUser {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  provider: string;
  email: string;
  user: {
    id: string;
    email: string;
    name: string;
    image?: string;
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Authenticate with the Spotify strategy
  const user = await authenticator.authenticate("spotify", request, {
    failureRedirect: "/accountmanager",
  }) as SpotifyUser;
  
  // Get the session and ensure the user data is stored in the SPOTIFY_SESSION_KEY
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  session.set(SPOTIFY_SESSION_KEY, user);
  
  // Get the current logged-in user email
  const userEmail = session.get("userEmail");
  
  if (!userEmail) {
    // If no user is logged in, redirect to login page
    return redirect("/login", {
      headers: {
        "Set-Cookie": await sessionStorage.commitSession(session),
      },
    });
  }
  
  // Get the database connection
  const db = await getDb();
  try {
    // Update the user record with the Spotify email
    await db.run(
      "UPDATE user SET user_spotify = ? WHERE user_email = ?",
      [user.user.email, userEmail]
    );
  } catch (error) {
    console.error("Error updating user record:", error);
  } finally {
    await db.close();
  }
  
  // Redirect to the account manager with the updated session
  return redirect("/accountmanager", {
    headers: {
      "Set-Cookie": await sessionStorage.commitSession(session),
    },
  });
}
