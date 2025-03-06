// app/services/auth.server.ts
import { Authenticator } from "remix-auth";
import { SpotifyStrategy } from "remix-auth-spotify";
import { GoogleStrategy } from "remix-auth-google";

import { sessionStorage } from "~/services/session.server";

// Re-export sessionStorage
export { sessionStorage };

if (!process.env.SPOTIFY_CLIENT_ID) {
  throw new Error("Missing SPOTIFY_CLIENT_ID env");
}

if (!process.env.SPOTIFY_CLIENT_SECRET) {
  throw new Error("Missing SPOTIFY_CLIENT_SECRET env");
}

if (!process.env.SPOTIFY_CALLBACK_URL) {
  throw new Error("Missing SPOTIFY_CALLBACK_URL env");
}

if (!process.env.GOOGLE_CLIENT_ID) {
  throw new Error("Missing GOOGLE_CLIENT_ID env");
}

if (!process.env.GOOGLE_CLIENT_SECRET) {
  throw new Error("Missing GOOGLE_CLIENT_SECRET env");
}

if (!process.env.GOOGLE_CALLBACK_URL) {
  throw new Error("Missing GOOGLE_CALLBACK_URL env");
}

// Define provider-specific session keys
export const SPOTIFY_SESSION_KEY = "spotify:session";
export const YOUTUBE_SESSION_KEY = "youtube:session";

// See https://developer.spotify.com/documentation/general/guides/authorization/scopes
const scopes = [
  "user-read-email",
  "playlist-read-private",
  "user-library-read",
].join(" ");

export const spotifyStrategy = new SpotifyStrategy(
  {
    clientID: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    callbackURL: process.env.SPOTIFY_CALLBACK_URL,
    sessionStorage,
    scope: scopes,
    sessionKey: SPOTIFY_SESSION_KEY,
  },
  async ({ accessToken, refreshToken, extraParams, profile }) => ({
    accessToken,
    refreshToken,
    expiresAt: Date.now() + extraParams.expiresIn * 1000,
    tokenType: extraParams.tokenType,
    provider: "spotify",
    email: profile.emails[0].value,
    user: {
      id: profile.id,
      email: profile.emails[0].value,
      name: profile.displayName,
      image: profile.__json.images?.[0]?.url,
    },
  })
);

export const googleStrategy = new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    callbackURL: process.env.GOOGLE_CALLBACK_URL || "",
    scope: "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email",
    
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async ({ accessToken, refreshToken, extraParams, profile }) => {
    // Get the user email from the profile
    const email = profile.emails[0].value;
    console.log(profile)
    // Return the user object that will be stored in the session
    return { 
      email, 
      accessToken, 
      refreshToken, 
      provider: "youtube",
      user: {
        id: profile.id,
        email: profile.emails[0].value,
        name: profile.displayName,
        image: profile.photos?.[0]?.value,
      },
    };
  }
);

// Create authenticator with default options
export const authenticator = new Authenticator(sessionStorage, {
  sessionKey: "auth:session", // Default session key
  sessionErrorKey: "auth:error", // Default error key
});

// Register strategies with proper session keys
authenticator.use(spotifyStrategy, "spotify");
authenticator.use(googleStrategy, "youtube");

// Helper functions for session access

// Get session for a specific provider
export async function getProviderSession(request: Request, provider: "spotify" | "youtube") {
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  
  // First try to get the session from the provider-specific key
  let providerSession = null;
  if (provider === "spotify") {
    providerSession = session.get(SPOTIFY_SESSION_KEY);
  } else {
    providerSession = session.get(YOUTUBE_SESSION_KEY);
  }
  
  // If not found, try the default authenticator session key
  if (!providerSession) {
    const authSession = session.get("auth:session");
    if (authSession && authSession.provider === provider) {
      providerSession = authSession;
    }
  }
  
  return providerSession;
}

// Get access token for a specific provider
export async function getProviderAccessToken(request: Request, provider: "spotify" | "youtube") {
  const session = await getProviderSession(request, provider);
  return session?.accessToken;
}

// Check if user is authenticated with a specific provider
export async function isAuthenticatedWithProvider(request: Request, provider: "spotify" | "youtube") {
  const session = await getProviderSession(request, provider);
  return !!session && session.provider === provider;
}

// Get all active provider sessions
export async function getActiveSessions(request: Request) {
  const spotifySession = await getProviderSession(request, "spotify");
  const youtubeSession = await getProviderSession(request, "youtube");
  
  return {
    spotify: spotifySession && spotifySession.provider === "spotify" ? spotifySession : null,
    youtube: youtubeSession && youtubeSession.provider === "youtube" ? youtubeSession : null
  };
}
