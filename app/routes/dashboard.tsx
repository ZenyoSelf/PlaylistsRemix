import type { MetaFunction, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Download, RefreshCw } from "lucide-react";
import { sessionStorage } from "~/services/session.server";
import { getUserByEmail } from "~/services/db.server";
import { getUserPreferredFormat, setUserPreferredFormat } from "~/services/userPreferences.server";
import FileFormatSelector from "~/components/FileFormatSelector";

export const meta: MetaFunction = () => {
  return [
    { title: "Music Dashboard" },
    { name: "description", content: "Manage your music from different platforms" },
  ];
};

export async function loader({ request }: LoaderFunctionArgs) {
  // Check if user is logged in
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  const userEmail = session.get("userEmail");
  
  if (!userEmail) {
    // If not logged in, redirect to login page
    return redirect("/login");
  }
  
  // Get user ID from email
  const user = await getUserByEmail(userEmail);
  if (!user) {
    return redirect("/login");
  }
  
  // Get user's preferred file format
  const preferredFormat = await getUserPreferredFormat(user.id);
  
  return json({ 
    userEmail,
    userId: user.id,
    preferredFormat
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const _action = formData.get("_action");
  
  if (_action === "updateFileFormat") {
    const userId = formData.get("userId");
    const fileFormat = formData.get("fileFormat");
    
    if (userId && fileFormat && typeof userId === "string" && typeof fileFormat === "string") {
      await setUserPreferredFormat(userId, fileFormat);
      return json({ success: true });
    }
    
    return json({ success: false, error: "Invalid form data" }, { status: 400 });
  }
  
  return json({ success: false, error: "Invalid action" }, { status: 400 });
}

export default function Dashboard() {
  const { userEmail, userId, preferredFormat } = useLoaderData<typeof loader>();
  
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Welcome to your music dashboard</h1>
      {userEmail && (
        <p className="text-sm text-muted-foreground mb-4">Logged in as: {userEmail}</p>
      )}
      
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
            <CardTitle>Library</CardTitle>
            <CardDescription>
              View and manage all your songs from different platforms
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/library">
              <Button className="w-full" variant="outline">
                <RefreshCw className="mr-2 h-4 w-4" />
                Go to Library
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
        
        {/* File Format Selector */}
        <FileFormatSelector userId={userId.toString()} currentFormat={preferredFormat} />
      </div>
    </div>
  );
} 