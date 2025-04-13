import { ActionFunctionArgs, json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { getMetadataFromUrl } from "~/services/ytDownload.server";
import { saveCustomUrlSong } from "~/services/db.server";
import { getProviderSession } from "~/services/auth.server";
import { downloadQueue } from "~/services/queue.server";
import { emitProgress } from "~/workers/downloadWorker.server";
import { Loader2, Music, Link as LinkIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { ToastMessage, jsonWithSuccess, jsonWithError } from "remix-toast";
import { toast } from "~/components/ui/use-toast";

export async function loader() {
  return json({
    supportedSites: [
      { name: "SoundCloud", url: "https://soundcloud.com" },
      { name: "Bandcamp", url: "https://bandcamp.com" },
      { name: "Beatport", url: "https://www.beatport.com" },
      { name: "Mixcloud", url: "https://www.mixcloud.com" },
      { name: "Deezer", url: "https://www.deezer.com" },
      { name: "Audiomack", url: "https://audiomack.com" },
      { name: "Jamendo", url: "https://www.jamendo.com" },
      { name: "Vimeo", url: "https://vimeo.com" },
      { name: "Twitch", url: "https://www.twitch.tv" },
      { name: "TikTok", url: "https://www.tiktok.com" }
    ]
  });
}

export async function action({ request }: ActionFunctionArgs) {
  // Try to get session from both providers
  const spotifySession = await getProviderSession(request, "spotify");
  const youtubeSession = await getProviderSession(request, "youtube");
  
  // Get emails from both sessions if available
  const spotifyEmail = spotifySession?.email || '';
  const youtubeEmail = youtubeSession?.email || '';
  
  // Check if at least one provider is authenticated
  if (!spotifyEmail && !youtubeEmail) {
    return jsonWithError({}, "You must be logged in to use this feature");
  }
  
  // Use the first available email
  const userEmail = spotifyEmail || youtubeEmail;

  const formData = await request.formData();
  const url = formData.get("url");

  if (!url) {
    return jsonWithError({}, "URL is required");
  }

  try {
    // Extract metadata from the URL
    const metadata = await getMetadataFromUrl(url as string);
    
    // Determine the platform - use the detected platform or "CustomURL" if unknown
    const platform = metadata.platform || "CustomURL";
    
    // Save the song to the database
    const songId = await saveCustomUrlSong(
      url as string,
      metadata.title,
      metadata.artist,
      metadata.thumbnailUrl,
      platform,
      userEmail
    );

    // Add to download queue
    const job = await downloadQueue.add({
      songId: songId.toString(),
      userId: userEmail,
    });

    // Emit queued event
    emitProgress(userEmail, {
      type: 'queued',
      progress: 0,
      jobId: job.id,
      songName: metadata.title
    });

    return jsonWithSuccess(
      { 
        success: true,
        songId,
        jobId: job.id,
        title: metadata.title,
        artist: metadata.artist,
        platform
      },
      `Added "${metadata.title}" to download queue`
    );
  } catch (error) {
    console.error("Error processing custom URL:", error);
    return jsonWithError(
      {},
      error instanceof Error ? error.message : "Failed to process URL"
    );
  }
}

export default function CustomUrlRoute() {
  const { supportedSites } = useLoaderData<typeof loader>();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [url, setUrl] = useState("");

  // Show toast notifications for action results
  useEffect(() => {
    if (actionData?.toast) {
      const { type, title, description } = actionData.toast as ToastMessage;
      toast({
        variant: type === "success" ? "default" : "destructive",
        title,
        description,
      });
    }
  }, [actionData]);

  return (
    <div className="container py-10 max-w-6xl">
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Custom URL Download</h1>
          <p className="text-muted-foreground">
            Download audio from any platform supported by yt-dlp, including SoundCloud, Bandcamp, and more.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <Card className="border-2 border-primary/10">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Music className="h-5 w-5 mr-2 text-primary" />
                  Add Custom URL
                </CardTitle>
                <CardDescription>
                  Enter a URL from any supported platform to download audio
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form method="post" className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="url">URL</Label>
                    <Input
                      id="url"
                      name="url"
                      type="url"
                      placeholder="https://soundcloud.com/artist/track"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      required
                      className="w-full"
                    />
                  </div>
                  <Button 
                    type="submit" 
                    disabled={isSubmitting} 
                    className="w-full"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Music className="mr-2 h-4 w-4" />
                        Download
                      </>
                    )}
                  </Button>
                </Form>
              </CardContent>
              <CardFooter className="border-t bg-muted/50 px-6 py-3">
                <p className="text-xs text-muted-foreground">
                  The download will be added to your queue and processed in the background
                </p>
              </CardFooter>
            </Card>

            {actionData?.success && (
              <Alert className="border-green-500/20 bg-green-500/10">
                <AlertTitle className="flex items-center text-green-600">
                  <Music className="h-4 w-4 mr-2" />
                  Success!
                </AlertTitle>
                <AlertDescription className="text-green-600">
                  Added &quot;{actionData.title}&quot; by {Array.isArray(actionData.artist) ? actionData.artist.join(", ") : actionData.artist} to download queue.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <div>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <LinkIcon className="h-5 w-5 mr-2 text-primary" />
                  Supported Platforms
                </CardTitle>
                <CardDescription>
                  These are some of the platforms supported by this feature
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  {supportedSites.map((site) => (
                    <a 
                      key={site.name} 
                      href={site.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center p-2 rounded-md hover:bg-accent transition-colors"
                    >
                      <LinkIcon className="h-4 w-4 mr-2 text-primary" />
                      <span className="text-sm">{site.name}</span>
                    </a>
                  ))}
                </div>
                <p className="mt-6 text-sm text-muted-foreground">
                  And many more! Any platform supported by yt-dlp should work with this feature.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
} 