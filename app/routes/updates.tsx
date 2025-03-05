import { ActionFunctionArgs, json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, Form, useNavigation } from "@remix-run/react";
import { getUserSongsFromDB, populateSongsForUser, getFilters } from "~/services/db.server";
import { getProviderSession } from "~/services/auth.server";
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
import { RefreshCw, Loader, CheckCircle, ChevronFirst, ChevronLast } from "lucide-react";
import { jsonWithError, jsonWithSuccess } from "remix-toast";
import { getTotalLikedSongsSpotify } from "~/services/selfApi.server";
import { useState } from "react";
import { DownloadButton } from "~/components/DownloadButton";
import { redirect } from "@remix-run/node";

interface LoaderData {
  songs: Song[];
  currentPage: number;
  totalPages: number;
  total: number;
  platforms: string[];
  playlists: string[];
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Check if the user is authenticated with either provider
  const spotifySession = await getProviderSession(request, "spotify");
  const youtubeSession = await getProviderSession(request, "youtube");
  
  // If not authenticated with either provider, redirect to account manager
  if (!spotifySession && !youtubeSession) {
    return redirect("/accountmanager");
  }

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const itemsPerPage = parseInt(url.searchParams.get("itemsPerPage") || "20");
  const search = url.searchParams.get("search") || "";
  const platform = url.searchParams.get("platform") || "";
  const playlist = url.searchParams.get("playlist") || "";
  const songStatus = url.searchParams.get("songStatus") || "";
  const sortBy = url.searchParams.get("sortBy") || "platform_added_at";
  const sortDirection = url.searchParams.get("sortDirection") || "desc";

  // Get songs with pagination and filters
  const songsResult = await getUserSongsFromDB(request, {
    page,
    itemsPerPage,
    search,
    platform,
    playlist,
    songStatus,
    sortBy,
    sortDirection: sortDirection as "desc" | "asc"
  });

  // Get filter options (platforms and playlists)
  const session = await getProviderSession(request, "spotify");
  const userEmail = session?.user?.email || '';
  const filterOptions = await getFilters(userEmail);

  const response: LoaderData = {
    songs: songsResult.songs,
    currentPage: songsResult.currentPage,
    totalPages: songsResult.totalPages,
    total: songsResult.total,
    platforms: filterOptions.platforms,
    playlists: filterOptions.playlists
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
  const { songs, currentPage, totalPages, total, platforms, playlists } = useLoaderData<typeof loader>();
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

  // Calculate pagination range
  const getPaginationRange = () => {
    const range = [];
    const maxPagesToShow = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
    const endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
    
    // Adjust start page if end page is at max
    if (endPage === totalPages) {
      startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }
    
    for (let i = startPage; i <= endPage; i++) {
      range.push(i);
    }
    
    return range;
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
          <div className="flex flex-wrap gap-4">
            <Input
              placeholder="Search songs..."
              value={searchParams.get("search") || ""}
              onChange={(e) => handleSearch(e.target.value)}
              className="max-w-sm"
            />
            <div className="w-48">
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
                  {platforms.map((platform) => (
                    <SelectItem key={platform} value={platform}>
                      {platform}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-48">
              <Select
                value={searchParams.get("playlist") || "all"}
                onValueChange={(value) => {
                  setSearchParams(prev => {
                    prev.set("playlist", value === "all" ? "" : value);
                    prev.set("page", "1");
                    return prev;
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Playlist" />
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
            <div className="w-48">
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
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="notDownloaded">Not Downloaded</SelectItem>
                  <SelectItem value="localFiles">Ready to Download</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Songs Table */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-2 text-sm text-gray-500">
            Showing {songs.length} of {total} songs (Page {currentPage} of {totalPages})
          </div>
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
                  <TableCell>
                    {(() => {
                      try {
                        // Parse the playlist JSON string into an array
                        const playlistStr = song.playlist || '[]';
                        const playlistArray = typeof playlistStr === 'string' 
                          ? JSON.parse(playlistStr) as string[]
                          : playlistStr as string[];
                        return playlistArray.join(', ');
                      } catch (e) {
                        // Fallback to displaying the raw value
                        return typeof song.playlist === 'string' 
                          ? song.playlist 
                          : Array.isArray(song.playlist) 
                            ? song.playlist.join(', ') 
                            : '';
                      }
                    })()}
                  </TableCell>
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
          
          {/* Improved Pagination */}
          {totalPages > 1 && (
            <Pagination className="mt-4">
              <PaginationContent>
                {/* Go to First Page */}
                {currentPage > 1 && (
                  <PaginationItem>
                    <button
                      onClick={() => handlePageChange(1)}
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2 cursor-pointer"
                      aria-label="Go to first page"
                    >
                      <ChevronFirst className="h-4 w-4" />
                    </button>
                  </PaginationItem>
                )}
                
                {/* Previous Page */}
                {currentPage > 1 && (
                  <PaginationItem>
                    <PaginationPrevious 
                      onClick={() => handlePageChange(currentPage - 1)}
                      className="cursor-pointer"
                    />
                  </PaginationItem>
                )}
                
                {/* Page Numbers */}
                {getPaginationRange().map(page => (
                  <PaginationItem key={page}>
                    <PaginationLink
                      isActive={page === currentPage}
                      onClick={() => handlePageChange(page)}
                      className="cursor-pointer"
                    >
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                
                {/* Next Page */}
                {currentPage < totalPages && (
                  <PaginationItem>
                    <PaginationNext 
                      onClick={() => handlePageChange(currentPage + 1)}
                      className="cursor-pointer"
                    />
                  </PaginationItem>
                )}
                
                {/* Go to Last Page */}
                {currentPage < totalPages && (
                  <PaginationItem>
                    <button
                      onClick={() => handlePageChange(totalPages)}
                      className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2 cursor-pointer"
                      aria-label="Go to last page"
                    >
                      <ChevronLast className="h-4 w-4" />
                    </button>
                  </PaginationItem>
                )}
              </PaginationContent>
            </Pagination>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
