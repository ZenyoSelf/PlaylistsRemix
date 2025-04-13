import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { authenticator, sessionStorage, YOUTUBE_SESSION_KEY } from "~/services/auth.server";
import { getDb } from "~/services/db.server";

// Define the type for the YouTube user
interface YouTubeUser {
  email: string;
  accessToken: string;
  refreshToken: string;
  provider: string;
  user: {
    id: string;
    email: string;
    name: string;
    image?: string;
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Authenticate with the YouTube strategy
  const user = await authenticator.authenticate("youtube", request, {
    failureRedirect: "/accountmanager",
  }) as YouTubeUser;

  // Get the session and ensure the user data is stored in the YOUTUBE_SESSION_KEY
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  session.set(YOUTUBE_SESSION_KEY, user);
  
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
    // Update the user record with the YouTube email
    await db.run(
      "UPDATE user SET user_youtube = ? WHERE user_email = ?",
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