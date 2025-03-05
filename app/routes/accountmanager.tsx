import { json, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";

import { Button } from "~/components/ui/button";
import { CardContent } from "~/components/ui/card";
import { Card } from "~/components/ui/card";
import { spotifyStrategy } from "~/services/auth.server";

export default function AccountManager() {
    const { spotifySession } = useLoaderData<typeof loader>();
    return (
        <div className="space-y-4">
            <div>
                <h1>Account Manager</h1>
            </div>
            <div>
                {/* Refresh Card */}
                <Card>
                    <CardContent className="p-4">
                        <div className="flex justify-between items-center">
                            <div>
                                <h3 className="text-lg font-medium">Spotify Account</h3>
                                <p className="text-sm text-muted-foreground">Log in to your spotify account to add your liked songs and playlists to the app</p>
                            </div>
                            <div className="flex items-center gap-2">

                                <Form method="post">
                                    <Button type="submit" name="action" value="spotify" variant="outline">
                                        {spotifySession ? "logout" : "login"}
                                    </Button>
                                </Form>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
            <div>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex justify-between items-center">
                            <div>
                                <h3 className="text-lg font-medium">Youtube Account</h3>
                                <p className="text-sm text-muted-foreground">Log in to your youtube account to add your liked songs and playlists to the app</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Form method="post">
                                    <Button type="submit" name="action" value="youtube" variant="outline">
                                        not yet implemented
                                    </Button>
                                </Form>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>

    )
}

export async function loader({ request }: LoaderFunctionArgs) {
    const spotifySession = await spotifyStrategy.getSession(request);
    return json({ spotifySession });
}




