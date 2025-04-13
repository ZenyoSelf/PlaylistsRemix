import type { MetaFunction } from "@remix-run/node";
import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Download, RefreshCw } from "lucide-react";
import { sessionStorage } from "~/services/session.server";

export const meta: MetaFunction = () => {
  return [
    { title: "Music Dashboard" },
    { name: "description", content: "Manage your music from different platforms" },
  ];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  const userEmail = session.get("userEmail");
  
  // If user is logged in, redirect to dashboard
  if (userEmail) {
    return redirect("/dashboard");
  }
  
  // Otherwise, redirect to login page
  return redirect("/login");
}

export default function Index() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Welcome to your music dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>New Additions</CardTitle>
            <CardDescription>
              View songs that have been added to your playlists but haven&apos;t been downloaded yet
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/new-additions">
              <Button className="w-full">
                <Download className="mr-2 h-4 w-4" />
                View New Additions
              </Button>
            </Link>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Updates</CardTitle>
            <CardDescription>
              View and manage all your songs from different platforms
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/updates">
              <Button className="w-full" variant="outline">
                <RefreshCw className="mr-2 h-4 w-4" />
                Go to Updates
              </Button>
            </Link>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Account Manager</CardTitle>
            <CardDescription>
              Manage your connected accounts and platforms
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/accountmanager">
              <Button className="w-full" variant="outline">
                Manage Accounts
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
