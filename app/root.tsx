import { json, LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";
import styles from "./global.css?url";
import Header from "./components/header";
import { Toaster } from "~/components/ui/toaster";
import { getToast } from "remix-toast";
import { useEffect } from "react";
import { useToast } from "./hooks/use-toast";


export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { toast, headers } = await getToast(request);
  return json({ toast }, { headers });
};

export function Layout({ children }: { children: React.ReactNode }) {
  const loaderData = useLoaderData<typeof loader>();
  const { toast } = useToast();

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
      <body className="container mx-auto">
        <Header />
        {children}
        <ScrollRestoration />
        <Scripts />
        <Toaster />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
