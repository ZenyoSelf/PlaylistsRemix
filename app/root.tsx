import { json, LinksFunction, LoaderFunctionArgs, redirect } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useLocation,
} from "@remix-run/react";
import styles from "./global.css?url";
import Header from "./components/header";
import { Toaster } from "~/components/ui/toaster";
import { getToast } from "remix-toast";
import { useEffect } from "react";
import { useToast } from "./hooks/use-toast";
import { sessionStorage } from "~/services/session.server";
import { getActiveSessions } from "~/services/auth.server";


export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { toast, headers } = await getToast(request);

  // Get the current URL
  const url = new URL(request.url);
  const path = url.pathname;

  // Public routes that don't require authentication
  const publicRoutes = ['/login', '/auth/spotify', '/auth/google', '/auth/spotify/callback', '/auth/google/callback'];

  // Check if the current route is a public route
  const isPublicRoute = publicRoutes.some(route => path.startsWith(route));

  let userEmail = null;
  let userId = null;
  if (!isPublicRoute) {
    // Check if user is logged in
    const session = await sessionStorage.getSession(request.headers.get("Cookie"));
    userEmail = session.get("userEmail");
    userId = session.get("userId");
    if (!userEmail) {
      // Try to get email from provider sessions
      const sessions = await getActiveSessions(request);
      if (sessions.spotify) {
        userEmail = sessions.spotify.email;

      } else if (sessions.youtube) {
        userEmail = sessions.youtube.email;

      }
    }

    if (!userEmail) {
      // User is not logged in, redirect to login page
      return redirect("/login");
    }
  }

  return json({ toast, path, userEmail, userId }, { headers });
};

export function Layout({ children }: { children: React.ReactNode }) {
  const loaderData = useLoaderData<typeof loader>();
  const { toast } = useToast();
  const location = useLocation();

  // Check if we're on the login page
  const isLoginPage = location.pathname === "/login";

  useEffect(() => {
    if (loaderData?.toast?.type === "error") {
      toast({
        title: "Error",
        description: loaderData.toast.message,
        variant: "destructive",
      });
    }
    if (loaderData?.toast?.type === "success") {
      toast({
        title: "Success",
        description: loaderData.toast.message,
        variant: "default",
      });
    }
  }, [toast, loaderData]);

  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="relative min-h-screen">
        <div className="mx-auto lg:max-w-7xl">
          {!isLoginPage && <Header userId={loaderData.userId} />}
          {children}
          <ScrollRestoration />
          <Scripts />
          <Toaster />
        </div>
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
