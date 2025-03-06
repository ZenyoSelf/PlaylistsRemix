import { ActionFunctionArgs, json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, Form, useNavigation } from "@remix-run/react";
import { getUserSongsFromDB, getFilters, refreshSpotifyLibrary, refreshYoutubeLibrary } from "~/services/db.server";
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
  CardHeader,
  CardTitle,
  CardDescription,
} from "~/components/ui/card";
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationLink, PaginationNext } from "~/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Loader, RefreshCw } from "lucide-react";
import { jsonWithError, jsonWithSuccess } from "remix-toast";
import { DownloadButton } from "~/components/DownloadButton";
import { redirect } from "@remix-run/node";

// Extend the Song type to include the user property
interface SongWithUser extends Song {
  user: string;
}

interface LoaderData {
  songs: SongWithUser[];
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
  const platform = url.searchParams.get("platform") || "";
  const playlist = url.searchParams.get("playlist") || "";
  const search = url.searchParams.get("search") || "";
  const sortBy = url.searchParams.get("sortBy") || "platform_added_at";
  const sortDirection = url.searchParams.get("sortDirection") || "desc";
  
  try {
    // Get songs that haven't been downloaded yet
    // Limit to 10 items per page to reduce simultaneous file system checks
    const { songs, currentPage, totalPages, total } = await getUserSongsFromDB(request, {
      page,
      search,
      platform,
      playlist,
      songStatus: "notDownloaded", // Only get songs that haven't been downloaded
      sortBy,
      sortDirection: sortDirection as "asc" | "desc",
      itemsPerPage: 10, // Reduced from default 20 to limit simultaneous file system checks
    });

    // Get filter options
    const { platforms, playlists } = await getFilters(request);

    return json<LoaderData>({
      songs,
      currentPage,
      totalPages,
      total,
      platforms,
      playlists,
    });
  } catch (error) {
    console.error("Error loading songs:", error);
    return jsonWithError(
      { songs: [], currentPage: 1, totalPages: 0, total: 0, platforms: [], playlists: [] },
      "Failed to load songs. Please try again."
    );
  }
}

export async function action({
  request,
}: ActionFunctionArgs) {
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "refreshSpotify") {
    try {
      const result = await refreshSpotifyLibrary(request);
      return jsonWithSuccess(
        { success: true },
        `Successfully refreshed Spotify library. Found ${result.total} new songs.`
      );
    } catch (error) {
      console.error("Error refreshing Spotify library:", error);
      return jsonWithError(
        { success: false },
        "Failed to refresh Spotify library. Please try again."
      );
    }
  }

  if (action === "refreshYoutube") {
    try {
      const result = await refreshYoutubeLibrary(request);
      return jsonWithSuccess(
        { success: true },
        `Successfully refreshed YouTube library. Found ${result.total} new songs.`
      );
    } catch (error) {
      console.error("Error refreshing YouTube library:", error);
      return jsonWithError(
        { success: false },
        "Failed to refresh YouTube library. Please try again."
      );
    }
  }

  return json({ success: false });
}

export default function NewAdditions() {
  const { songs, currentPage, totalPages, total, platforms, playlists } = useLoaderData<LoaderData>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  
  const isSubmittingAction = (actionValue: string) => {
    if (navigation.state === "submitting") {
      const formData = navigation.formData;
      return formData?.get("action") === actionValue;
    }
    return false;
  };

  const handleSearch = (value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set("search", value);
    } else {
      newParams.delete("search");
    }
    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  const handlePageChange = (newPage: number) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("page", newPage.toString());
    setSearchParams(newParams);
  };

  const getPaginationRange = () => {
    const range = [];
    const maxPagesToShow = 5;
    const startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
    const endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);

    for (let i = startPage; i <= endPage; i++) {
      range.push(i);
    }

    return range;
  };

  return (
    <div className="container mx-auto py-8">
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>New Additions</CardTitle>
          <CardDescription>
            Songs that have been added to your playlists but haven&apos;t been downloaded yet.
            Total: {total} songs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4 mb-4">
            <div className="flex-1">
              <Input
                type="text"
                placeholder="Search songs..."
                defaultValue={searchParams.get("search") || ""}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-full"
              />
            </div>
            <div className="flex gap-2">
              <Form method="post">
                <input type="hidden" name="action" value="refreshSpotify" />
                <Button type="submit" variant="outline" disabled={isSubmittingAction("refreshSpotify")}>
                  {isSubmittingAction("refreshSpotify") ? (
                    <>
                      <Loader className="mr-2 h-4 w-4 animate-spin" />
                      Refreshing Spotify...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Refresh Spotify
                    </>
                  )}
                </Button>
              </Form>
              <Form method="post">
                <input type="hidden" name="action" value="refreshYoutube" />
                <Button type="submit" variant="outline" disabled={isSubmittingAction("refreshYoutube")}>
                  {isSubmittingAction("refreshYoutube") ? (
                    <>
                      <Loader className="mr-2 h-4 w-4 animate-spin" />
                      Refreshing YouTube...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Refresh YouTube
                    </>
                  )}
                </Button>
              </Form>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-4 mb-4">
            <div className="flex-1">
              <Select
                value={searchParams.get("platform") || "all"}
                onValueChange={(value) => {
                  const newParams = new URLSearchParams(searchParams);
                  if (value && value !== "all") {
                    newParams.set("platform", value);
                  } else {
                    newParams.delete("platform");
                  }
                  newParams.set("page", "1");
                  setSearchParams(newParams);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Filter by platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Platforms</SelectItem>
                  {platforms.map((platform) => (
                    <SelectItem key={platform} value={platform}>
                      {platform === "Spotify" ? (
                        <div className="flex items-center">
                          <SpotifyLogo className="mr-2 h-4 w-4" />
                          {platform}
                        </div>
                      ) : platform === "Youtube" ? (
                        <div className="flex items-center">
                          <YoutubeLogo className="mr-2 h-4 w-4" />
                          {platform}
                        </div>
                      ) : (
                        platform
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Select
                value={searchParams.get("playlist") || "all"}
                onValueChange={(value) => {
                  const newParams = new URLSearchParams(searchParams);
                  if (value && value !== "all") {
                    newParams.set("playlist", value);
                  } else {
                    newParams.delete("playlist");
                  }
                  newParams.set("page", "1");
                  setSearchParams(newParams);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Filter by playlist" />
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
            <div className="flex-1">
              <Select
                value={`${searchParams.get("sortBy") || "platform_added_at"}-${
                  searchParams.get("sortDirection") || "desc"
                }`}
                onValueChange={(value) => {
                  const [sortBy, sortDirection] = value.split("-");
                  const newParams = new URLSearchParams(searchParams);
                  newParams.set("sortBy", sortBy);
                  newParams.set("sortDirection", sortDirection);
                  setSearchParams(newParams);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="platform_added_at-desc">Newest First</SelectItem>
                  <SelectItem value="platform_added_at-asc">Oldest First</SelectItem>
                  <SelectItem value="title-asc">Title (A-Z)</SelectItem>
                  <SelectItem value="title-desc">Title (Z-A)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {songs.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center">
            <p className="text-lg text-gray-500">
              No new songs found. Try refreshing your library or adjusting your filters.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Artist</TableHead>
                    <TableHead>Album</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead>Added At</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {songs.map((song) => (
                    <TableRow key={song.id}>
                      <TableCell className="font-medium">{song.title}</TableCell>
                      <TableCell>
                        {song.artist_name?.join(", ") || "Unknown Artist"}
                      </TableCell>
                      <TableCell>{song.album || "Unknown Album"}</TableCell>
                      <TableCell>
                        {song.platform === "Spotify" ? (
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
                        )}
                      </TableCell>
                      <TableCell>
                        {new Date(song.platform_added_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <DownloadButton songId={song.id.toString()} userId={song.user} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {totalPages > 1 && (
            <div className="mt-4 flex justify-center">
              <Pagination>
                <PaginationContent>
                  {currentPage > 1 && (
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          handlePageChange(currentPage - 1);
                        }}
                      />
                    </PaginationItem>
                  )}

                  {currentPage > 3 && (
                    <>
                      <PaginationItem>
                        <PaginationLink
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            handlePageChange(1);
                          }}
                        >
                          1
                        </PaginationLink>
                      </PaginationItem>
                      {currentPage > 4 && (
                        <PaginationItem>
                          <span className="px-4">...</span>
                        </PaginationItem>
                      )}
                    </>
                  )}

                  {getPaginationRange().map((page) => (
                    <PaginationItem key={page}>
                      <PaginationLink
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          handlePageChange(page);
                        }}
                        isActive={page === currentPage}
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  ))}

                  {currentPage < totalPages - 2 && (
                    <>
                      {currentPage < totalPages - 3 && (
                        <PaginationItem>
                          <span className="px-4">...</span>
                        </PaginationItem>
                      )}
                      <PaginationItem>
                        <PaginationLink
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            handlePageChange(totalPages);
                          }}
                        >
                          {totalPages}
                        </PaginationLink>
                      </PaginationItem>
                    </>
                  )}

                  {currentPage < totalPages && (
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          handlePageChange(currentPage + 1);
                        }}
                      />
                    </PaginationItem>
                  )}
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SpotifyLogo({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2ZM16.5917 16.5917C16.2931 16.8903 15.8162 16.8903 15.5176 16.5917C14.4889 15.563 13.0432 15 11.5 15C9.95685 15 8.51115 15.563 7.48239 16.5917C7.18384 16.8903 6.70693 16.8903 6.40837 16.5917C6.10982 16.2931 6.10982 15.8162 6.40837 15.5176C7.73115 14.1949 9.55685 13.5 11.5 13.5C13.4432 13.5 15.2689 14.1949 16.5917 15.5176C16.8903 15.8162 16.8903 16.2931 16.5917 16.5917ZM18.364 13.636C18.0654 13.9346 17.5885 13.9346 17.29 13.636C15.7389 12.0849 13.6932 11.25 11.5 11.25C9.30685 11.25 7.26115 12.0849 5.71005 13.636C5.4115 13.9346 4.93459 13.9346 4.63604 13.636C4.33748 13.3374 4.33748 12.8605 4.63604 12.562C6.48115 10.7169 8.91685 9.75 11.5 9.75C14.0832 9.75 16.5189 10.7169 18.364 12.562C18.6625 12.8605 18.6625 13.3374 18.364 13.636ZM20.1362 10.6569C19.8376 10.9554 19.3607 10.9554 19.0622 10.6569C16.9889 8.58359 14.3432 7.5 11.5 7.5C8.65685 7.5 6.01115 8.58359 3.93783 10.6569C3.63928 10.9554 3.16237 10.9554 2.86382 10.6569C2.56526 10.3583 2.56526 9.88141 2.86382 9.58286C5.23115 7.21552 8.26685 6 11.5 6C14.7332 6 17.7689 7.21552 20.1362 9.58286C20.4348 9.88141 20.4348 10.3583 20.1362 10.6569Z" fill="currentColor" />
    </svg>
  );
}

function YoutubeLogo({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M23.4985 6.29825C23.3667 5.85054 23.1111 5.44961 22.7597 5.14153C22.4083 4.83345 21.9764 4.63062 21.5139 4.55825C19.6714 4.20825 12.1764 4.20825 12.1764 4.20825C12.1764 4.20825 4.68145 4.20825 2.83895 4.55825C2.37644 4.63062 1.94457 4.83345 1.59315 5.14153C1.24173 5.44961 0.986198 5.85054 0.854395 6.29825C0.504395 8.05825 0.504395 11.4083 0.504395 11.4083C0.504395 11.4083 0.504395 14.7583 0.854395 16.5183C0.986198 16.966 1.24173 17.3669 1.59315 17.675C1.94457 17.9831 2.37644 18.1859 2.83895 18.2583C4.68145 18.6083 12.1764 18.6083 12.1764 18.6083C12.1764 18.6083 19.6714 18.6083 21.5139 18.2583C21.9764 18.1859 22.4083 17.9831 22.7597 17.675C23.1111 17.3669 23.3667 16.966 23.4985 16.5183C23.8485 14.7583 23.8485 11.4083 23.8485 11.4083C23.8485 11.4083 23.8485 8.05825 23.4985 6.29825ZM9.76645 14.4083V8.40825L15.9764 11.4083L9.76645 14.4083Z" fill="currentColor" />
    </svg>
  );
} 