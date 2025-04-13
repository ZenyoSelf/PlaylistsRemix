import { json, LoaderFunctionArgs, ActionFunctionArgs, redirect } from "@remix-run/node";
import { Form, useLoaderData, Link } from "@remix-run/react";

import { Button } from "~/components/ui/button";
import { CardContent } from "~/components/ui/card";
import { Card } from "~/components/ui/card";
import { getActiveSessions, sessionStorage, SPOTIFY_SESSION_KEY, YOUTUBE_SESSION_KEY } from "~/services/auth.server";

export default function AccountManager() {
    const { sessions, userEmail } = useLoaderData<typeof loader>();
    
    return (
        <div className="space-y-4">
            <div>
                <h1 className="text-2xl font-bold mb-4">Account Manager</h1>
                <p className="text-muted-foreground mb-6">Connect your music platform accounts to sync your playlists and liked songs.</p>
                {userEmail && (
                    <p className="text-sm text-muted-foreground mb-4">Logged in as: {userEmail}</p>
                )}
            </div>
            <div>
                {/* Spotify Card */}
                <Card>
                    <CardContent className="p-4">
                        <div className="flex justify-between items-center">
                            <div>
                                <h3 className="text-lg font-medium">Spotify Account</h3>
                                <p className="text-sm text-muted-foreground">Log in to your Spotify account to add your liked songs and playlists to the app</p>
                                {sessions.spotify && (
                                    <p className="text-sm text-green-500 mt-1">Connected as: {sessions.spotify.email}</p>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                {sessions.spotify ? (
                                    <Form method="post">
                                        <Button type="submit" name="action" value="logout-spotify" variant="outline">
                                            Logout
                                        </Button>
                                    </Form>
                                ) : (
                                    <Link to="/auth/spotify">
                                        <Button variant="outline">
                                            Login with Spotify
                                        </Button>
                                    </Link>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
            <div>
                {/* YouTube Card */}
                <Card>
                    <CardContent className="p-4">
                        <div className="flex justify-between items-center">
                            <div>
                                <h3 className="text-lg font-medium">YouTube Account</h3>
                                <p className="text-sm text-muted-foreground">Log in to your YouTube account to add your playlists to the app</p>
                                {sessions.youtube && (
                                    <p className="text-sm text-green-500 mt-1">Connected as: {sessions.youtube.email}</p>
                                )}
                            </div>
                            <div className="flex items-center gap-2">
                                {sessions.youtube ? (
                                    <Form method="post">
                                        <Button type="submit" name="action" value="logout-youtube" variant="outline">
                                            Logout
                                        </Button>
                                    </Form>
                                ) : (
                                    <Link to="/auth/google">
                                        <Button variant="outline">
                                            Login with YouTube
                                        </Button>
                                    </Link>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
            <div className="mt-6">
                <Form method="post">
                    <Button type="submit" name="action" value="logout-app" variant="destructive">
                        Logout from App
                    </Button>
                </Form>
            </div>
        </div>
    );
}

export async function loader({ request }: LoaderFunctionArgs) {
    const session = await sessionStorage.getSession(request.headers.get("Cookie"));
    const userEmail = session.get("userEmail");
    
    // If user is not logged in, redirect to login page
    if (!userEmail) {
        return redirect("/login");
    }
    
    const sessions = await getActiveSessions(request);
    return json({ sessions, userEmail });
}

export async function action({ request }: ActionFunctionArgs) {
    const formData = await request.formData();
    const action = formData.get("action");
    const session = await sessionStorage.getSession(request.headers.get("Cookie"));
    
    if (action === "logout-spotify") {
        // Logout from Spotify only
        session.unset(SPOTIFY_SESSION_KEY);
        return redirect("/accountmanager", {
            headers: {
                "Set-Cookie": await sessionStorage.commitSession(session)
            }
        });
    } else if (action === "logout-youtube") {
        // Logout from YouTube only
        session.unset(YOUTUBE_SESSION_KEY);
        return redirect("/accountmanager", {
            headers: {
                "Set-Cookie": await sessionStorage.commitSession(session)
            }
        });
    } else if (action === "logout-app") {
        // Logout from the entire app
        return redirect("/dashboard", {
            headers: {
                "Set-Cookie": await sessionStorage.destroySession(session)
            }
        });
    }
    
    return redirect("/accountmanager");
}




