import { ActionFunction, LoaderFunctionArgs, json } from "@remix-run/node";
import { Form, useLoaderData, useSearchParams, useSubmit } from "@remix-run/react";
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
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationLink, PaginationEllipsis, PaginationNext } from "~/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "~/components/ui/input";


interface LoaderData {
  session: Session | null;
  songs: Song[];
  page: number;
  itemsPerPage: number;
  platforms: string[];
  playlists: string[];
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export async function loader({ request }: LoaderFunctionArgs) {
  //Here handle all playlists and liked tracks
  //For now, only selected playlists

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page")) || 1;
  const itemsPerPage = Number(url.searchParams.get("itemsPerPage")) || 10;
  const platform = url.searchParams.get("platform") || "all";
  const playlist = url.searchParams.get("playlist") || "all";
  const session = await spotifyStrategy.getSession(request);

  if (!session) {
    return json<LoaderData>({
      session: null,
      songs: [],
      page,
      itemsPerPage,
      platforms: [], // Available platforms
      playlists: [], // Available playlists
    });
  }

  //TODO: Filtering
  const userSongs = await getUserSongsFromDB(request, PAGE_SIZE_OPTIONS[0]);

  // Get unique platforms and playlists for filters
  const platforms = Array.from(new Set(userSongs.map(song => song.platform)));

  const playlists = Array.from(
    new Set(userSongs.map(song => song.playlist).filter((playlist): playlist is string => playlist !== null))
  );

  // TODO: when filtering done, this isn't needed
  let filteredSongs = userSongs;
  if (platform !== "all") {
    filteredSongs = filteredSongs.filter(song => song.platform === platform);
  }
  if (playlist !== "all") {
    filteredSongs = filteredSongs.filter(song => song.playlist === playlist);
  }

  return json<LoaderData>({
    session,
    songs: filteredSongs,
    page,
    itemsPerPage,
    platforms,
    playlists,
  });
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
  const { session,
    songs: initialSongs,
    platforms,
    playlists, } = useLoaderData<typeof loader>();
  const [songs, setSongs] = useState(initialSongs);
  const [totalSongs, setTotalSongs] = useState(0)
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentPage, setCurrentPage] = useState(Number(searchParams.get("page")) || 1);
  const [itemsPerPage, setItemsPerPage] = useState(Number(searchParams.get("itemsPerPage")) || 10);
  const currentPlatform = searchParams.get("platform") || "all";
  const currentPlaylist = searchParams.get("playlist") || "all";
  const totalPages = Math.ceil(totalSongs / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentSongs = songs.slice(startIndex, endIndex);

  const handleFilterChange = (type: "platform" | "playlist" | "itemsPerPage", value: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set(type, value);
    newParams.set("page", "1"); // Reset to first page when filtering
    setSearchParams(newParams, {
      preventScrollReset: true
    })
    submit(newParams);
  };

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


  const handleSearchSong = (song) => {
    console.log(song);
  }


  // Handle page changes
  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  // Handle items per page change
  const handleItemsPerPageChange = (value) => {
    setItemsPerPage(Number(value));
    setCurrentPage(1); // Reset to first page when changing items per page
  };

  // Calculate downloaded songs count
  const downloadedCount = songs.filter(song => song.downloaded).length;

  return (
    <>
      <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.8" }}>
        <h1>Newest addition</h1>
      </div>


      {/* Summary card */}
      <Card className="w-[350px] mb-6">
        <CardHeader>
          <CardTitle>Summary</CardTitle>
          <CardDescription>
            {currentPlatform === "all" ? "All platforms" : currentPlatform} •
            {currentPlaylist === "all" ? "All playlists" : currentPlaylist}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-between items-center">
          <div>
            <div className="text-sm text-gray-500">Downloaded</div>
            <div className="text-2xl font-bold">{downloadedCount} / {totalSongs}</div>
          </div>
          <Button
            onClick={() => {/* Handle bulk download */ }}
            disabled={downloadedCount === totalSongs}
          >
            Download All
          </Button>
        </CardContent>
      </Card>
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
      {/* Add filter controls */}
      <div className="flex gap-4 mb-6">
        {/* Platform filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Platform:</span>
          <Select
            value={currentPlatform}
            onValueChange={(value) => handleFilterChange("platform", value)}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Platforms</SelectItem>
              {platforms.map((platform) => (
                <SelectItem key={platform} value={platform}>
                  {platform}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Playlist filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Playlist:</span>
          <Select
            value={currentPlaylist}
            onValueChange={(value) => handleFilterChange("playlist", value)}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Playlists</SelectItem>
              {playlists.map((playlist) => (
                <SelectItem key={playlist} value={playlist}>
                  {playlist}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>


      </div>
      <div>
        <Input
          placeholder="Search for song..."
          onChange={(event) =>
            handleSearchSong(event.target.value)
          }
          className="max-w-sm"
        />
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
              {/* Items per page selector */}
              <TableCell colSpan={10}>
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() => handlePageChange(currentPage - 1)}
                        className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      />
                    </PaginationItem>

                    {[...Array(totalPages)].map((_, index) => {
                      const pageNumber = index + 1;
                      // Show first page, current page, last page and neighbors
                      if (
                        pageNumber === 1 ||
                        pageNumber === totalPages ||
                        (pageNumber >= currentPage - 1 && pageNumber <= currentPage + 1)
                      ) {
                        return (
                          <PaginationItem key={pageNumber}>
                            <PaginationLink
                              onClick={() => handlePageChange(pageNumber)}
                              isActive={currentPage === pageNumber}
                            >
                              {pageNumber}
                            </PaginationLink>
                          </PaginationItem>
                        );
                      } else if (
                        (pageNumber === currentPage - 2 && currentPage > 3) ||
                        (pageNumber === currentPage + 2 && currentPage < totalPages - 2)
                      ) {
                        return (
                          <PaginationItem key={pageNumber}>
                            <PaginationEllipsis />
                          </PaginationItem>
                        );
                      }
                      return null;
                    })}

                    <PaginationItem>
                      <PaginationNext
                        onClick={() => handlePageChange(currentPage + 1)}
                        className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
                <Select
                  value={itemsPerPage.toString()}
                  onValueChange={handleItemsPerPageChange}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <SelectItem key={size} value={size.toString()}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>


      </div >
    </>
  );
}
