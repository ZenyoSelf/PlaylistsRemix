// app/services/session.server.ts
import { createCookieSessionStorage } from "@remix-run/node";

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "appSession", // use any name you want here
    sameSite: "lax",
    path: "/",
    httpOnly: true,
    secrets: ["s3cr3t"], // replace this with an actual secret from env variable
    secure: false, // enable this in prod only
  },
});

export const { getSession, commitSession, destroySession } = sessionStorage;
