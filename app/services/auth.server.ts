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

// Create the authenticator
export const authenticator = new Authenticator(sessionStorage);

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
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
    scope: "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email",
    accessType: "offline",
    prompt: "consent",
  },
  async ({ accessToken, refreshToken, extraParams, profile }) => ({
    accessToken,
    refreshToken,
    expiresAt: Date.now() + extraParams.expires_in * 1000,
    tokenType: extraParams.token_type,
    provider: "youtube",
    email: profile.emails[0].value,
    user: {
      id: profile.id,
      email: profile.emails[0].value,
      name: profile.displayName,
      image: profile._json.picture,
    },
  })
);

// Register strategies with proper session keys
authenticator.use(spotifyStrategy, "spotify");
authenticator.use(googleStrategy, "youtube");

/**
 * Refresh Spotify access token using the refresh token
 * @param refreshToken The refresh token
 * @returns New access token and expiration time
 */
export async function refreshSpotifyToken(refreshToken: string) {
  try {
    console.log("Refreshing Spotify access token...");
    
    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refreshToken);
    
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(
          `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString("base64")}`,
      },
      body: params,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error refreshing token: ${response.status} ${response.statusText}`, errorText);
      throw new Error(`Failed to refresh token: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  } catch (error) {
    console.error("Error refreshing Spotify token:", error);
    throw error;
  }
}

/**
 * Refresh YouTube access token using the refresh token
 * @param refreshToken The refresh token
 * @returns New access token and expiration time
 */
export async function refreshYouTubeToken(refreshToken: string) {
  try {
    console.log("Refreshing YouTube access token...");
    
    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refreshToken);
    
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(
          `${process.env.GOOGLE_CLIENT_ID}:${process.env.GOOGLE_CLIENT_SECRET}`
        ).toString("base64")}`,
      },
      body: params,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error refreshing token: ${response.status} ${response.statusText}`, errorText);
      throw new Error(`Failed to refresh token: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  } catch (error) {
    console.error("Error refreshing YouTube token:", error);
    throw error;
  }
}

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
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  const providerSession = await getProviderSession(request, provider);
  
  if (!providerSession) {
    return null;
  }
  
  // If the token is expired, refresh it
  if (providerSession.expiresAt < Date.now()) {
    try {
      console.log(`${provider} token expired, refreshing...`);
      
      if (!providerSession.refreshToken) {
        console.error("No refresh token available");
        return null;
      }
      
      // Refresh the token
      const { accessToken, expiresAt } = provider === "spotify" 
        ? await refreshSpotifyToken(providerSession.refreshToken)
        : await refreshYouTubeToken(providerSession.refreshToken);
      
      // Update the session with the new token
      const updatedSession = {
        ...providerSession,
        accessToken,
        expiresAt,
      };
      
      // Update the session storage
      const sessionKey = provider === "spotify" ? SPOTIFY_SESSION_KEY : YOUTUBE_SESSION_KEY;
      session.set(sessionKey, updatedSession);
      
      // Commit the session
      const cookie = await sessionStorage.commitSession(session);
      
      // Append the cookie to the request headers for future requests in this context
      const headers = new Headers(request.headers);
      headers.set("Cookie", cookie);
      
      // Create a new request with the updated headers
      Object.defineProperty(request, "headers", {
        value: headers,
        writable: true,
      });
      
      console.log(`${provider} token refreshed successfully`);
      
      return accessToken;
    } catch (error) {
      console.error(`Failed to refresh ${provider} token:`, error);
      return null;
    }
  }
  
  return providerSession?.accessToken;
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
