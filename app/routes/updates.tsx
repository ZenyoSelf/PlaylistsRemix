import { ActionFunction, LoaderFunctionArgs, json } from "@remix-run/node";
import { Form, useLoaderData, useSubmit } from "@remix-run/react";
import { useRef, useState } from "react";
import { Session } from "remix-auth-spotify";
import { spotifyStrategy } from "~/services/auth.server";
import { getUserSongsFromDB } from "~/services/db.server";
import { Song, TracksRefresh } from "~/types/customs";
import { FaSpotify } from "react-icons/fa";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "~/components/ui/menubar";

import { Check, Download } from "lucide-react";
import { downloadSpotifySong } from "~/services/selfApi.server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Button } from "~/components/ui/button";
interface LoaderData {
  session: Session | null;
  songs: Song[];
}

export async function loader({ request }: LoaderFunctionArgs) {
  //Here handle all playlists and liked tracks
  //For now, only selected playlists
  const session = await spotifyStrategy.getSession(request);

  if (!session) {
    return json<LoaderData>({ session: null, songs: [] });
  }

  const userSongs = await getUserSongsFromDB(request);
  return json<LoaderData>({ session, songs: userSongs });
}

export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const songName = formData.get("songName") as string;
  const artists = formData.getAll("artist") as string[];
  const playlistName = formData.get("playlistName") as string;

  try {
    const result = await downloadSpotifySong(
      songName,
      artists,
      playlistName
    ).catch((reason) => {
      console.log(reason);
    });
    return json({ success: true, result });
  } catch (error) {
    return json({ success: false, error });
  }
};

export default function Updates() {
  const { session, songs: initialSongs } = useLoaderData<typeof loader>();
  const [songs, setSongs] = useState(initialSongs);
  const [totalSongs, setTotalSongs] = useState(0)
  const submit = useSubmit();
  const loginFormRef = useRef<HTMLFormElement>(null);
  const handleLoginLogout = () => {
    if (loginFormRef.current) {
      loginFormRef.current.submit();
    }
  };

  const handleSubmitSong = (
    songName: string,
    songUrl: string,
    playlistName: string,
    artists: string[] | null
  ) => {
    const formData = new FormData();
    formData.append("songName", songName.toString());
    formData.append("songUrl", songUrl.toString());
    formData.append("playlistName", playlistName.toString());
    if (artists) {
      artists.forEach((artist) => {
        formData.append("artist", artist);
      });
    }

    submit(formData, { method: "post", action: "/updates" });
  };

  const handleRefresh = async () => {
    if (session) {
      const response = await fetch("/tracks/refresh", {
        method: "POST",
      });
      if (response.ok) {
        const data: TracksRefresh =
          await response.json();
        setSongs(data.songs);
        console.log("handle refresh total");
        console.log(data.total);
        setTotalSongs(data.total);

      }
    }
  };

  return (
    <>
      <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.8" }}>
        <h1>Newest addition</h1>
      </div>
      <div>
        <Card className="w-[350px]">
          <CardHeader>
            <CardTitle>Resume</CardTitle>
            <CardDescription>
              Total news songs since last addition
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap">
            <i>1/100</i>
            <Button>Download All</Button>
          </CardContent>
        </Card>
      </div>
      <div>
        <Menubar>
          <MenubarMenu>
            <MenubarTrigger>Login</MenubarTrigger>
            <MenubarContent>
              <Form
                ref={loginFormRef}
                action={session?.user ? "/logout" : "/auth/spotify"}
                method="post"
              >
                <MenubarItem inset onClick={handleLoginLogout}>
                  <div className="flex flex-nowrap">
                    <p className="flex-auto">
                      {session?.user ? "Logout" : "Log in"}
                    </p>
                    <FaSpotify className="flex-auto ml-2" size={24} />
                  </div>
                </MenubarItem>
              </Form>
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger>Refresh</MenubarTrigger>
            <MenubarContent>
              <MenubarItem onClick={handleRefresh}>Refresh All</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
      </div>
      <div>
        <Table>
          <TableCaption>A list of your recent added songs.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Artists</TableHead>
              <TableHead>Album</TableHead>
              <TableHead>Playlist</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead className="text-right">Downloaded ?</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {songs.map((song) => (
              <TableRow key={song.id}>
                <TableCell className="font-medium">{song.title}</TableCell>
                <TableCell>{song.artists}</TableCell>
                <TableCell>{song.album}</TableCell>
                <TableCell>{song.playlist}</TableCell>
                <TableCell>{song.platform}</TableCell>
                <TableCell
                  className="flex items-end justify-end"
                  onClick={() =>
                    handleSubmitSong(
                      song.title!,
                      song.url,
                      song.playlist!,
                      song.artists
                    )
                  }
                >
                  {song.downloaded ? (
                    <Check size={24} />
                  ) : (
                    <Download size={24} type="submit"></Download>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={5}>0 / {totalSongs}</TableCell>
              <TableCell className="text-right">TOTAL NOT DOWNLOADED</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </>
  );
}
