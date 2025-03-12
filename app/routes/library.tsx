import { ActionFunctionArgs, json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, Form, useNavigation } from "@remix-run/react";
import { getUserSongsFromDB, populateSongsForUser, getFilters, refreshSpotifyLibrary, refreshYoutubeLibrary, getLatestRefresh } from "~/services/db.server";
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
import { Loader, CheckCircle, ChevronFirst, ChevronLast, Clock } from "lucide-react";
import { jsonWithError, jsonWithSuccess } from "remix-toast";
import { getTotalLikedSongsSpotify } from "~/services/selfApi.server";
import { useState } from "react";
import { DownloadButton } from "~/components/DownloadButton";
import { redirect } from "@remix-run/node";
import { sessionStorage } from "~/services/session.server";
interface LoaderData {
  userId: string;
  songs: Song[];
  currentPage: number;
  totalPages: number;
  total: number;
  platforms: string[];
  playlists: { name: string, platform: string }[];
  lastRefreshSpotify: string | null;
  lastRefreshYoutube: string | null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Check if the user is authenticated with either provider
  const spotifySession = await getProviderSession(request, "spotify");
  const youtubeSession = await getProviderSession(request, "youtube");
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  const userId = session.get("userId");
  // If not authenticated with either provider, redirect to account manager
  if (!spotifySession && !youtubeSession) {
    return redirect("/accountmanager");
  }

  // Get last refresh times
  let lastRefreshSpotify = null;
  let lastRefreshYoutube = null;
  
  if (spotifySession?.email) {
    lastRefreshSpotify = await getLatestRefresh(spotifySession.email, 'spotify');
  }
  
  if (youtubeSession?.email) {
    lastRefreshYoutube = await getLatestRefresh(youtubeSession.email, 'youtube');
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

  // Get filter options (platforms and playlists) from all authenticated accounts
  const filterOptions = await getFilters(request);

  const response: LoaderData = {
    userId: userId,
    songs: songsResult.songs,
    currentPage: songsResult.currentPage,
    totalPages: songsResult.totalPages,
    total: songsResult.total,
    platforms: filterOptions.platforms,
    playlists: filterOptions.playlists,
    lastRefreshSpotify,
    lastRefreshYoutube
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
  } else if (action == "refresh_spotify") {
    try {
      const result = await refreshSpotifyLibrary(request);
      
      if (!result.success) {
        return jsonWithError(
          {
            songs: result.songs,
            total: result.total
          },
          result.message
        );
      }
      
      return jsonWithSuccess(
        {
          songs: result.songs,
          total: result.total
        },
        result.message
      );
    } catch (error) {
      return jsonWithError(
        {
          songs: [],
          total: 0
        },
        error instanceof Error ? error.message : "Failed to sync Spotify library"
      );
    }
  } else if (action == "refresh_youtube") {
    try {
      const result = await refreshYoutubeLibrary(request);
      
      return jsonWithSuccess(
        {
          songs: result.songs,
          total: result.total
        },
        "Successfully refreshed YouTube playlists"
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to sync YouTube playlists";
      const isAuthError = errorMessage.includes("Unauthorized") || errorMessage.includes("authentication");
      
      return jsonWithError(
        {
          songs: [],  
          total: 0
        },
        isAuthError 
          ? "YouTube authentication failed. Please go to the Account Manager and reconnect your YouTube account." 
          : errorMessage
      );
    }
  }
  
  return null;
}

export default function Library() {
  const { userId, songs, currentPage, totalPages, total, platforms, playlists, lastRefreshSpotify, lastRefreshYoutube } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const [downloadingSongs] = useState<Set<string>>(new Set());
  
  // Check if a specific action is submitting
  const isSubmittingAction = (actionValue: string) => {
    if (navigation.state !== "submitting") return false;
    const formData = navigation.formData;
    return formData && formData.get("action") === actionValue;
  };
  
  const isRefreshingSpotify = isSubmittingAction("refresh_spotify");
  const isRefreshingYoutube = isSubmittingAction("refresh_youtube");
  
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

  // Format playlist names for display
  const formatPlaylist = (song: Song) => {
    if (song.playlists && song.playlists.length > 0) {
      return song.playlists.map(p => p.name).join(', ');
    }
    
    // Fallback to old playlist field for backward compatibility
    if (!song.playlist) return '';
    
    try {
      if (typeof song.playlist === 'string') {
        return song.playlist;
      } else if (Array.isArray(song.playlist)) {
        return song.playlist.join(', ');
      } else {
        const parsed = JSON.parse(typeof song.playlist === 'string' ? song.playlist : '[]');
        return Array.isArray(parsed) ? parsed.join(', ') : '';
      }
    } catch (e) {
      return typeof song.playlist === 'string' ? song.playlist : '';
    }
  };

  // Format date for display
  const formatDate = (dateString: string | null): string => {
    if (!dateString) return 'Never';
    
    try {
      const date = new Date(dateString);
      // Use a specific format instead of toLocaleString() to ensure consistency between server and client
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const seconds = date.getSeconds().toString().padStart(2, '0');
      return `${day}.${month}.${year} ${hours}:${minutes}:${seconds}`;
    } catch (e) {
      return 'Invalid date';
    }
  };

  return (
    <div className="space-y-4">
      {/* Refresh Card */}
      <Card>
        <CardContent className="p-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Database Sync</h3>
              <p className="text-sm text-muted-foreground">Refresh your songs from your music platforms</p>
              <p className="text-sm text-muted-foreground mt-1">
                <a href="/accountmanager" className="text-blue-500 hover:underline">
                  Manage your connected accounts
                </a>
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Form method="post" className="flex flex-col items-end">
                  <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Last sync: {formatDate(lastRefreshSpotify)}
                  </div>
                  <Button 
                    type="submit" 
                    name="action" 
                    value="refresh_spotify" 
                    variant="outline"
                    disabled={isRefreshingSpotify || isRefreshingYoutube}
                    className="flex items-center gap-2"
                  >
                    {isRefreshingSpotify ? (
                      <Loader className="h-4 w-4 animate-spin" />
                    ) : (
                      <SpotifyLogo className="h-4 w-4" />
                    )}
                    Sync Spotify
                  </Button>
                </Form>
                
                <Form method="post" className="flex flex-col items-end">
                  <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Last sync: {formatDate(lastRefreshYoutube)}
                  </div>
                  <Button 
                    type="submit" 
                    name="action" 
                    value="refresh_youtube" 
                    variant="outline"
                    disabled={isRefreshingSpotify || isRefreshingYoutube}
                    className="flex items-center gap-2"
                  >
                    {isRefreshingYoutube ? (
                      <Loader className="h-4 w-4 animate-spin" />
                    ) : (
                      <YoutubeLogo className="h-4 w-4" />
                    )}
                    Sync YouTube Playlists
                  </Button>
                </Form>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search and Filters */}
      <div className="relative mx-auto">
      <Card>
        <CardContent className="p-4 space-y-4 relative">
          <div className="flex flex-wrap gap-4 relative">
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
                    <SelectItem key={`${playlist.name}-${playlist.platform}`} value={playlist.name}>
                      {playlist.name}
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
      </div>
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
                  <TableCell>{song.platform === "Spotify" ? (
                              <div className="flex items-center">
                                <SpotifyLogo className="mr-2 h-4 w-4" />
                                Spotify
                              </div>
                            ) : song.platform === "Youtube" ? (
                              <div className="flex items-center">
                                <YoutubeLogo className="mr-2 h-4 w-4" />
                                YouTube
                              </div>
                            ) : (
                              song.platform
                            )}</TableCell>
                  <TableCell>
                    {formatPlaylist(song)}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const date = new Date(song.platform_added_at);
                      const day = date.getDate().toString().padStart(2, '0');
                      const month = (date.getMonth() + 1).toString().padStart(2, '0');
                      const year = date.getFullYear();
                      return `${day}.${month}.${year}`;
                    })()}
                  </TableCell>
                  <TableCell>
                    <div className="relative inline-block">
                      <DownloadButton songId={song.id.toString()} userId={userId} />
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

// Spotify Logo Component
function SpotifyLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
    >
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

// YouTube Logo Component
function YoutubeLogo({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
} 