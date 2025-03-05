import { ActionFunctionArgs, json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, Form, useNavigation } from "@remix-run/react";
import { getUserSongsFromDB, populateSongsForUser } from "~/services/db.server";
import { Song } from "~/types/customs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

import {
  Card,
  CardContent,
} from "~/components/ui/card";
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationLink, PaginationNext } from "~/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { RefreshCw, Loader, CheckCircle } from "lucide-react";
import { jsonWithError, jsonWithSuccess } from "remix-toast";
import { getTotalLikedSongsSpotify } from "~/services/selfApi.server";
import { useState } from "react";
import { DownloadButton } from "~/components/DownloadButton";

interface LoaderData {
  songs: Song[];
  currentPage: number;
  totalPages: number;
  platforms: string[];
  playlists: string[];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const itemsPerPage = parseInt(url.searchParams.get("itemsPerPage") || "20");
  const search = url.searchParams.get("search") || "";
  const platform = url.searchParams.get("platform") || "";
  const playlist = url.searchParams.get("playlist") || "";
  const songStatus = url.searchParams.get("songStatus") || "";
  const sortBy = url.searchParams.get("sortBy") || "platform_added_at";
  const sortDirection = url.searchParams.get("sortDirection") || "desc";

  const { songs, currentPage, totalPages } = await getUserSongsFromDB(request, {
    page,
    itemsPerPage,
    search,
    platform,
    playlist,
    songStatus,
    sortBy,
    sortDirection: sortDirection as "desc" | "asc"
  });

  const platforms = [...new Set(songs.map(song => song.platform))];
  const playlists = [...new Set(songs.map(song => song.playlist))].filter(Boolean);

  const response: LoaderData = {
    songs,
    currentPage,
    totalPages,
    platforms,
    playlists
  };

  return json(response);
}

export async function action({
  request,
}: ActionFunctionArgs) {
  const formData = await request.formData();
  const action = formData.get("action");

  if (action == "refresh") {
    try {
      // Get newest addition, then add to db
      await populateSongsForUser(request);

      // Then, get the updated songs from DB
      const userSongs = await getUserSongsFromDB(request, {
        page: 1,
        itemsPerPage: 10
      });

      // Get the total count
      const total = await getTotalLikedSongsSpotify(request);

      return jsonWithSuccess(
        {
          songs: userSongs.songs,
          total: total
        },
        "Successfully refreshed library"
      );

    } catch (error) {
      return jsonWithError(
        {
          songs: [],
          total: 0
        },
        error instanceof Error ? error.message : "Failed to sync library"
      );
    }
  }
}

export default function Updates() {
  const { songs, currentPage, totalPages } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const [downloadingSongs] = useState<Set<string>>(new Set());

  // Handle search input
  const handleSearch = (value: string) => {
    setSearchParams(prev => {
      prev.set("search", value);
      prev.set("page", "1"); // Reset to first page on new search
      return prev;
    });
  };

  // Handle pagination
  const handlePageChange = (newPage: number) => {
    setSearchParams(prev => {
      prev.set("page", newPage.toString());
      return prev;
    });
  };

  return (
    <div className="space-y-4">
      {/* Refresh Card */}
      <Card>
        <CardContent className="p-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Database Sync</h3>
              <p className="text-sm text-muted-foreground">Refresh your songs from Spotify</p>
            </div>
            <div className="flex items-center gap-2">

              <Form method="post">
                <Button type="submit" name="action" value="refresh" variant="outline">
                  {navigation.state === "submitting" ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Sync Library
                </Button>
              </Form>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search and Filters */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex gap-4">
            <Input
              placeholder="Search songs..."
              value={searchParams.get("search") || ""}
              onChange={(e) => handleSearch(e.target.value)}
              className="max-w-sm"
            />
            <Select
              value={searchParams.get("platform") || "all"}
              onValueChange={(value) => {
                setSearchParams(prev => {
                  prev.set("platform", value === "all" ? "" : value);
                  prev.set("page", "1");
                  return prev;
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Platforms</SelectItem>
                <SelectItem value="Spotify">Spotify</SelectItem>
                <SelectItem value="Youtube">Youtube</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={searchParams.get("songStatus") || "all"}
              onValueChange={(value) => {
                setSearchParams(prev => {
                  prev.set("songStatus", value === "all" ? "" : value);
                  prev.set("page", "1");
                  return prev;
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Song Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="notDownloaded">Not Downloaded</SelectItem>
                <SelectItem value="localFiles">Ready to Download</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Songs Table */}
      <Card>
        <CardContent className="p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Image</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Artist</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Playlist</TableHead>
                <TableHead>Added At</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {songs.map((song) => (
                <TableRow
                  key={song.id}
                  className={downloadingSongs.has(song.id.toString()) ? "opacity-50 pointer-events-none" : ""}
                >
                  <TableCell className="relative">
                    {song.album_image && (
                      <>
                        <img
                          src={song.album_image}
                          alt={`${song.album} cover`}
                          className="w-16 h-16 rounded-sm object-cover"
                        />
                        {downloadingSongs.has(song.id.toString()) && (
                          <div className="absolute inset-0 flex items-center justify-center bg-background/50 rounded-sm">
                            <Loader className="h-6 w-6 animate-spin text-primary" />
                          </div>
                        )}
                      </>
                    )}
                  </TableCell>
                  <TableCell>{song.title}</TableCell>
                  <TableCell>
                    {song.artist_name?.join(", ") || ""}
                  </TableCell>
                  <TableCell>{song.platform}</TableCell>
                  <TableCell>{song.playlist}</TableCell>
                  <TableCell>{new Date(song.platform_added_at).toLocaleDateString('en-GB', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                  })}</TableCell>
                  <TableCell>
                    <div className="relative inline-block">
                      <DownloadButton songId={song.id.toString()} userId="arnaud" />
                      {song.downloaded ?  (
                        <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground rounded-full w-4 h-4 text-xs flex items-center justify-center">
                          <CheckCircle className="h-3 w-3" />
                        </span>
                      ) : ""}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      <Pagination className="mt-4">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              onClick={(e) => {
                if (currentPage === 1) e.preventDefault();
                else handlePageChange(currentPage - 1);
              }}
              aria-disabled={currentPage === 1}
            />
          </PaginationItem>

          {/* Add page numbers here */}
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => (
            <PaginationItem key={i}>
              <PaginationLink
                onClick={() => handlePageChange(i + 1)}
                isActive={currentPage === i + 1}
              >
                {i + 1}
              </PaginationLink>
            </PaginationItem>
          ))}

          <PaginationItem>
            <PaginationNext
              onClick={(e) => {
                if (currentPage === totalPages) e.preventDefault();
                else handlePageChange(currentPage + 1);
              }}
              aria-disabled={currentPage === totalPages}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
