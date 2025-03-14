import { ActionFunctionArgs, json, LoaderFunctionArgs, redirect } from "@remix-run/node";
import { useLoaderData, useSearchParams, Form, useNavigation } from "@remix-run/react";
import { getUserSongsFromDB, getFilters, refreshSpotifyLibrary, refreshYoutubeLibrary, getLatestRefresh, markSongsAsDownloadedBeforeDate, getAllSongIdsWithFilter } from "~/services/db.server";
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
import { Loader, RefreshCw, Package, Clock, CheckSquare } from "lucide-react";
import { jsonWithError, jsonWithSuccess } from "remix-toast";
import { toast } from "~/components/ui/use-toast";
import { useEffect, useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { DatePicker } from "~/components/ui/date-picker";

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
  playlists: { name: string, platform: string }[];
  lastRefreshSpotify: string | null;
  lastRefreshYoutube: string | null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Check if the user is authenticated with either provider
  const spotifySession = await getProviderSession(request, "spotify");
  const youtubeSession = await getProviderSession(request, "youtube");

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
  console.log("spotifySession", spotifySession);
  console.log("youtubeSession", youtubeSession);

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const platform = url.searchParams.get("platform") || "";
  const playlist = url.searchParams.get("playlist") || "";
  const search = url.searchParams.get("search") || "";
  const sortBy = url.searchParams.get("sortBy") || "platform_added_at";
  const sortDirection = url.searchParams.get("sortDirection") || "desc";
  const onlyMyPlaylists = url.searchParams.get("onlyMyPlaylists") === "true";
  
  // Get excluded playlists from URL parameters
  const excludedPlaylists = url.searchParams.get("excludedPlaylists") 
    ? url.searchParams.get("excludedPlaylists")!.split(',')
    : [];

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
      onlyMyPlaylists, // Add this parameter to filter by user's playlists
      excludedPlaylists, // Add excluded playlists
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
      lastRefreshSpotify,
      lastRefreshYoutube,
    });
  } catch (error) {
    console.error("Error loading songs:", error);
    return jsonWithError(
      {
        songs: [],
        currentPage: 1,
        totalPages: 0,
        total: 0,
        platforms: [],
        playlists: [],
        lastRefreshSpotify: null,
        lastRefreshYoutube: null,
      },
      "Failed to load songs. Please try again."
    );
  }
}

export async function action({
  request,
}: ActionFunctionArgs) {
  const formData = await request.formData();
  const action = formData.get("action");

  // Get user email from session
  const spotifySession = await getProviderSession(request, "spotify");
  const youtubeSession = await getProviderSession(request, "youtube");

  // Get emails from both sessions if available
  const spotifyEmail = spotifySession?.email || '';
  const youtubeEmail = youtubeSession?.email || '';

  // Check if at least one provider is authenticated
  if (!spotifyEmail && !youtubeEmail) {
    return jsonWithError({}, "You must be logged in to use this feature");
  }

  if (action === "refresh-spotify") {
    try {
      const result = await refreshSpotifyLibrary(request);
      return jsonWithSuccess(result, "Spotify library refreshed successfully");
    } catch (error) {
      console.error("Error refreshing Spotify library:", error);
      return jsonWithError({}, "Failed to refresh Spotify library");
    }
  } else if (action === "refresh-youtube") {
    try {
      const result = await refreshYoutubeLibrary(request);
      return jsonWithSuccess(result, "YouTube library refreshed successfully");
    } catch (error) {
      console.error("Error refreshing YouTube library:", error);
      return jsonWithError({}, "Failed to refresh YouTube library");
    }
  } else if (action === "download-all") {
    try {
      // Get filter parameters from form data
      const platform = formData.get("platform") as string || '';
      const playlist = formData.get("playlist") as string || '';
      const search = formData.get("search") as string || '';
      const onlyMyPlaylists = formData.get("onlyMyPlaylists") === "true";
      const excludedPlaylists = formData.get("excludedPlaylists") as string || '';

      // Create filter parameters object
      const filterParams = {
        platform: platform !== 'all' ? platform : '',
        playlist: playlist !== 'all' ? playlist : '',
        search,
        songStatus: 'notDownloaded', // Only include songs that haven't been downloaded
        onlyMyPlaylists,
        excludedPlaylists: excludedPlaylists ? excludedPlaylists.split(',') : [],
      };

      // Get all song IDs that match the filter criteria without pagination
      const songIds = await getAllSongIdsWithFilter(request, filterParams);

      if (songIds.length === 0) {
        return jsonWithError({}, "No songs found matching the filter criteria");
      }

      // Get the request URL to build an absolute URL
      const url = new URL(request.url);
      const baseUrl = `${url.protocol}//${url.host}`;

      // Call the bulk download API with only userId and songIds using an absolute URL
      const response = await fetch(`${baseUrl}/api/bulk-download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ songIds, spotifyEmail, youtubeEmail }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to queue bulk download');
      }

      const data = await response.json();

      return jsonWithSuccess(
        { jobId: data.jobId, songCount: data.songCount },
        `Added ${data.songCount} songs to download queue`
      );
    } catch (error) {
      console.error("Error queuing bulk download:", error);
      return jsonWithError({}, error instanceof Error ? error.message : "Failed to queue bulk download");
    }
  } else if (action === "mark-as-downloaded") {
    try {
      const beforeDate = formData.get("beforeDate") as string;
      const onlyMyPlaylists = formData.get("onlyMyPlaylists") === "true";
      const excludedPlaylistsStr = formData.get("excludedPlaylists") as string || '';
      const excludedPlaylists = excludedPlaylistsStr ? excludedPlaylistsStr.split(',') : [];

      if (!beforeDate) {
        return jsonWithError({}, "Please select a date");
      }

      // Convert date to ISO string if it's not already
      const dateObj = new Date(beforeDate);
      const isoDate = dateObj.toISOString();

      // Mark songs as downloaded
      const updatedCount = await markSongsAsDownloadedBeforeDate(request, isoDate, onlyMyPlaylists, excludedPlaylists);

      return jsonWithSuccess(
        { updatedCount },
        `Marked ${updatedCount} songs as downloaded`
      );
    } catch (error) {
      console.error("Error marking songs as downloaded:", error);
      return jsonWithError({}, error instanceof Error ? error.message : "Failed to mark songs as downloaded");
    }
  } else if (action === "save-excluded-playlists") {
    try {
      // Get the excluded playlist names from the form data
      const excludedPlaylists = formData.getAll("excludedPlaylists").map(name => name.toString());
      
      // Redirect to the same page with the excluded playlists in the URL
      const url = new URL(request.url);
      
      if (excludedPlaylists.length > 0) {
        url.searchParams.set("excludedPlaylists", excludedPlaylists.join(','));
      } else {
        url.searchParams.delete("excludedPlaylists");
      }
      
      return redirect(url.toString());
    } catch (error) {
      console.error("Error saving excluded playlists:", error);
      return jsonWithError({}, error instanceof Error ? error.message : "Failed to save excluded playlists");
    }
  }

  return redirect("/new-additions");
}

export default function NewAdditions() {
  const { songs, currentPage, totalPages, platforms, playlists, lastRefreshSpotify, lastRefreshYoutube, total } = useLoaderData<LoaderData>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const actionData = navigation.formData;
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isExcludeDialogOpen, setIsExcludeDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [onlyMyPlaylists, setOnlyMyPlaylists] = useState(false);
  const [expandedPlatforms, setExpandedPlatforms] = useState<Record<string, boolean>>({
    "Spotify": true,
    "Youtube": true
  });
  


  // Initialize selectedPlaylists from URL parameters
  const [selectedPlaylists, setSelectedPlaylists] = useState<string[]>(
    searchParams.get("excludedPlaylists") 
      ? searchParams.get("excludedPlaylists")!.split(',')
      : []
  );
  
  // Group playlists by platform
  const playlistsByPlatform = useMemo(() => {
    const grouped: Record<string, string[]> = {};
    
    playlists.forEach(playlist => {
      // Use the platform information from the playlist object
      const platformKey = playlist.platform === "Youtube" ? "Youtube" : 
                         playlist.platform === "Spotify" ? "Spotify" : "Other";
      
      grouped[platformKey] = grouped[platformKey] || [];
      grouped[platformKey].push(playlist.name);
    });
    
    return grouped;
  }, [playlists]);
  
  // Add state for playlist search
  const [playlistSearch, setPlaylistSearch] = useState("");
  
  // Filter playlists based on search term
  const filteredPlaylistsByPlatform = useMemo(() => {
    if (!playlistSearch.trim()) {
      return playlistsByPlatform;
    }
    
    const searchTerm = playlistSearch.toLowerCase();
    const filtered: Record<string, string[]> = {};
    
    Object.entries(playlistsByPlatform).forEach(([platform, playlists]) => {
      const filteredPlaylists = playlists.filter(playlist => 
        playlist.toLowerCase().includes(searchTerm)
      );
      
      if (filteredPlaylists.length > 0) {
        filtered[platform] = filteredPlaylists;
      }
    });
    
    return filtered;
  }, [playlistsByPlatform, playlistSearch]);
  
  // Toggle platform expansion
  const togglePlatformExpansion = (platform: string) => {
    setExpandedPlatforms(prev => ({
      ...prev,
      [platform]: !prev[platform]
    }));
  };
  
  // Show toast notifications for action results
  useEffect(() => {
    if (navigation.state === "loading" && navigation.formData?.get("action") === "download-all") {
      toast({
        title: "Processing",
        description: "Preparing songs for download...",
      });
    }
  }, [navigation.state, navigation.formData]);

  const isSubmittingAction = (actionValue: string) => {
    return (
      navigation.state === "submitting" &&
      actionData?.get("action") === actionValue
    );
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

  const handlePlatformChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value && value !== "all") {
      newParams.set("platform", value);
    } else {
      newParams.delete("platform");
    }
    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  const handlePlaylistChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value && value !== "all") {
      newParams.set("playlist", value);
    } else {
      newParams.delete("playlist");
    }
    newParams.set("page", "1");
    setSearchParams(newParams);
  };

  // Format date for display
  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Never";
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
      return "Invalid date";
    }
  };

  // Add this function to handle checkbox changes for excluded playlists
  const handlePlaylistCheckboxChange = (playlistName: string) => {
    setSelectedPlaylists(prev => {
      if (prev.includes(playlistName)) {
        return prev.filter(name => name !== playlistName);
      } else {
        return [...prev, playlistName];
      }
    });
  };

  // Add these functions to handle select all and deselect all
  const selectAllPlaylistsForPlatform = (platform: string) => {
    const platformPlaylists = playlistsByPlatform[platform] || [];
    const newSelectedPlaylists = [...selectedPlaylists];
    
    platformPlaylists.forEach(playlist => {
      if (!newSelectedPlaylists.includes(playlist)) {
        newSelectedPlaylists.push(playlist);
      }
    });
    
    setSelectedPlaylists(newSelectedPlaylists);
  };
  
  const deselectAllPlaylistsForPlatform = (platform: string) => {
    const platformPlaylists = playlistsByPlatform[platform] || [];
    const newSelectedPlaylists = selectedPlaylists.filter(
      playlist => !platformPlaylists.includes(playlist)
    );
    
    setSelectedPlaylists(newSelectedPlaylists);
  };

  // Add this function to count selected playlists for a platform
  const getSelectedPlaylistsCountForPlatform = (platform: string) => {
    const platformPlaylists = playlistsByPlatform[platform] || [];
    return platformPlaylists.filter(playlist => selectedPlaylists.includes(playlist)).length;
  };

  return (
    <div className="container py-8">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">New Additions</h1>
          <p className="text-muted-foreground">
            View and download songs that have been added to your playlists since your last refresh.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <CardTitle>Library Controls</CardTitle>
                  <CardDescription>
                    Refresh your library or filter the results
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Form method="post">
                    <input type="hidden" name="action" value="refresh-spotify" />
                    <div className="text-xs text-muted-foreground mb-1 flex items-center justify-end gap-1">
                      <Clock className="h-3 w-3" />
                      Last sync: {formatDate(lastRefreshSpotify)}
                    </div>
                    <Button
                      type="submit"
                      variant="outline"
                      disabled={isSubmittingAction("refresh-spotify")}
                    >
                      {isSubmittingAction("refresh-spotify") ? (
                        <Loader className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      Refresh Spotify
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="action" value="refresh-youtube" />
                    <div className="text-xs text-muted-foreground mb-1 flex items-center justify-end gap-1">
                      <Clock className="h-3 w-3" />
                      Last sync: {formatDate(lastRefreshYoutube)}
                    </div>
                    <Button
                      type="submit"
                      variant="outline"
                      disabled={isSubmittingAction("refresh-youtube")}
                    >
                      {isSubmittingAction("refresh-youtube") ? (
                        <Loader className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      Refresh YouTube
                    </Button>
                  </Form>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                {/* First row: Platform, Playlist, and Ownership filters */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="w-full">
                    <label htmlFor="platform-filter" className="text-sm font-medium mb-1 block">
                      Platform
                    </label>
                    <div id="platform-filter">
                      <Select
                        value={searchParams.get("platform") || "all"}
                        onValueChange={(value) => handlePlatformChange(value)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="All Platforms" />
                        </SelectTrigger>
                        <SelectContent className="min-w-[200px]">
                          <SelectItem value="all">All Platforms</SelectItem>
                          {platforms.map((platform) => (
                            <SelectItem key={platform} value={platform}>
                              {platform}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="w-full">
                    <label htmlFor="playlist-filter" className="text-sm font-medium mb-1 block">
                      Playlist
                    </label>
                    <div id="playlist-filter">
                      <Select
                        value={searchParams.get("playlist") || "all"}
                        onValueChange={(value) => handlePlaylistChange(value)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="All Playlists" />
                        </SelectTrigger>
                        <SelectContent className="min-w-[200px] max-h-[300px]">
                          <SelectItem value="all">All Playlists</SelectItem>
                          {playlists.map((playlist) => (
                            <SelectItem key={`${playlist.name}-${playlist.platform}`} value={playlist.name}>
                              {playlist.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="w-full">
                    <label htmlFor="my-playlists-filter" className="text-sm font-medium mb-1 block">
                      Ownership
                    </label>
                    <div id="my-playlists-filter" className="flex items-center h-10 px-3 border rounded-md">
                      <Checkbox id="only-my-playlists" checked={searchParams.get("onlyMyPlaylists") === "true"} onCheckedChange={(checked) => {
                        const newParams = new URLSearchParams(searchParams);
                        if (checked === true) {
                          newParams.set("onlyMyPlaylists", "true");
                        } else {
                          newParams.delete("onlyMyPlaylists");
                        }
                        newParams.set("page", "1");
                        setSearchParams(newParams);
                      }}></Checkbox>

                      <label htmlFor="only-my-playlists" className="text-sm ml-2">
                        Only my playlists
                      </label>
                    </div>
                  </div>
                </div>
                
                {/* Second row: Search and action buttons */}
                <div className="flex flex-col md:flex-row gap-4 items-end">
                  <div className="flex-1">
                    <label htmlFor="search-input" className="text-sm font-medium mb-1 block">
                      Search
                    </label>
                    <Input
                      id="search-input"
                      type="text"
                      placeholder="Search by title or artist..."
                      value={searchParams.get("search") || ""}
                      onChange={(e) => handleSearch(e.target.value)}
                      className="w-full"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Dialog open={isExcludeDialogOpen} onOpenChange={setIsExcludeDialogOpen}>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          className="whitespace-nowrap"
                          title="Exclude playlists from the new additions view"
                        >
                          <svg 
                            className="mr-2 h-4 w-4" 
                            width="15" 
                            height="15" 
                            viewBox="0 0 15 15" 
                            fill="none" 
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path 
                              d="M1.5 3C1.22386 3 1 3.22386 1 3.5C1 3.77614 1.22386 4 1.5 4H13.5C13.7761 4 14 3.77614 14 3.5C14 3.22386 13.7761 3 13.5 3H1.5ZM1.5 7C1.22386 7 1 7.22386 1 7.5C1 7.77614 1.22386 8 1.5 8H13.5C13.7761 8 14 7.77614 14 7.5C14 7.22386 13.7761 7 13.5 7H1.5ZM1 11.5C1 11.2239 1.22386 11 1.5 11H13.5C13.7761 11 14 11.2239 14 11.5C14 11.7761 13.7761 12 13.5 12H1.5C1.22386 12 1 11.7761 1 11.5Z" 
                              fill="currentColor" 
                              fillRule="evenodd" 
                              clipRule="evenodd"
                            ></path>
                          </svg>
                          Exclude Playlists
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[500px] max-h-[80vh]">
                        <DialogHeader>
                          <DialogTitle>Exclude Playlists</DialogTitle>
                          <DialogDescription>
                            Select playlists to exclude from the new additions view. Songs that are only in these playlists will not be shown.
                          </DialogDescription>
                        </DialogHeader>
                        <Form
                          method="post"
                          onSubmit={() => {
                            setIsExcludeDialogOpen(false);
                          }}
                        >
                          <input type="hidden" name="action" value="save-excluded-playlists" />
                          <div className="py-2">
                            <div className="relative">
                              <input
                                type="text"
                                placeholder="Search playlists..."
                                className="w-full px-3 py-2 border rounded-md"
                                value={playlistSearch}
                                onChange={(e) => setPlaylistSearch(e.target.value)}
                              />
                              {playlistSearch && (
                                <button
                                  type="button"
                                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
                                  onClick={() => setPlaylistSearch("")}
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="py-4 overflow-y-auto max-h-[50vh]">
                            {Object.entries(filteredPlaylistsByPlatform).map(([platform, platformPlaylists]) => (
                              <div key={platform} className="mb-4 border rounded-md p-3">
                                <div 
                                  className="flex items-center justify-between cursor-pointer"
                                  onClick={() => togglePlatformExpansion(platform)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      togglePlatformExpansion(platform);
                                    }
                                  }}
                                  role="button"
                                  tabIndex={0}
                                  aria-expanded={expandedPlatforms[platform]}
                                >
                                  <h3 className="text-sm font-medium">{platform}</h3>
                                  <div className="flex items-center">
                                    <span className="text-xs text-muted-foreground mr-2">
                                      {getSelectedPlaylistsCountForPlatform(platform)}/{playlistsByPlatform[platform].length} selected
                                    </span>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 w-8 p-0"
                                    >
                                      {expandedPlatforms[platform] ? (
                                        <svg 
                                          className="h-4 w-4" 
                                          width="15" 
                                          height="15" 
                                          viewBox="0 0 15 15" 
                                          fill="none" 
                                          xmlns="http://www.w3.org/2000/svg"
                                        >
                                          <path 
                                            d="M3.13523 6.15803C3.3241 5.95657 3.64052 5.94637 3.84197 6.13523L7.5 9.56464L11.158 6.13523C11.3595 5.94637 11.6759 5.95657 11.8648 6.15803C12.0536 6.35949 12.0434 6.67591 11.842 6.86477L7.84197 10.6148C7.64964 10.7951 7.35036 10.7951 7.15803 10.6148L3.15803 6.86477C2.95657 6.67591 2.94637 6.35949 3.13523 6.15803Z" 
                                            fill="currentColor" 
                                            fillRule="evenodd" 
                                            clipRule="evenodd"
                                          ></path>
                                        </svg>
                                      ) : (
                                        <svg 
                                          className="h-4 w-4" 
                                          width="15" 
                                          height="15" 
                                          viewBox="0 0 15 15" 
                                          fill="none" 
                                          xmlns="http://www.w3.org/2000/svg"
                                        >
                                          <path 
                                            d="M6.1584 3.13508C6.35985 2.94621 6.67627 2.95642 6.86514 3.15788L10.6151 7.15788C10.7954 7.3502 10.7954 7.64949 10.6151 7.84182L6.86514 11.8418C6.67627 12.0433 6.35985 12.0535 6.1584 11.8646C5.95694 11.6757 5.94673 11.3593 6.1356 11.1579L9.565 7.49985L6.1356 3.84182C5.94673 3.64036 5.95694 3.32394 6.1584 3.13508Z" 
                                            fill="currentColor" 
                                            fillRule="evenodd" 
                                            clipRule="evenodd"
                                          ></path>
                                        </svg>
                                      )}
                                    </Button>
                                  </div>
                                </div>
                                {expandedPlatforms[platform] && (
                                  <div className="mt-2 pl-2">
                                    <div className="flex justify-end space-x-2 mb-2">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => selectAllPlaylistsForPlatform(platform)}
                                      >
                                        Select All
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => deselectAllPlaylistsForPlatform(platform)}
                                      >
                                        Deselect All
                                      </Button>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2">
                                      {platformPlaylists.map((playlist) => (
                                        <div key={playlist} className="flex items-center space-x-2">
                                          <Checkbox
                                            id={`playlist-${playlist}`}
                                            name="excludedPlaylists"
                                            value={playlist}
                                            checked={selectedPlaylists.includes(playlist)}
                                            onCheckedChange={() => {
                                              handlePlaylistCheckboxChange(playlist);
                                            }}
                                          />
                                          <label
                                            htmlFor={`playlist-${playlist}`}
                                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                          >
                                            {playlist}
                                          </label>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                          <DialogFooter>
                            <Button
                              type="submit"
                              disabled={isSubmittingAction("save-excluded-playlists")}
                            >
                              {isSubmittingAction("save-excluded-playlists") ? (
                                <Loader className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                "Save Exclusions"
                              )}
                            </Button>
                          </DialogFooter>
                        </Form>
                      </DialogContent>
                    </Dialog>
                    
                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          className="whitespace-nowrap"
                          title="Mark songs as downloaded without actually downloading them"
                        >
                          <CheckSquare className="mr-2 h-4 w-4" />
                          Mark as Downloaded
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                          <DialogTitle>Mark Songs as Downloaded</DialogTitle>
                          <DialogDescription>
                            Mark songs added before a specific date as downloaded without actually downloading them.
                          </DialogDescription>
                        </DialogHeader>
                        <Form
                          method="post"
                          onSubmit={() => {
                            setIsDialogOpen(false);
                          }}
                        >
                          <input type="hidden" name="action" value="mark-as-downloaded" />
                          <input
                            type="hidden"
                            name="beforeDate"
                            value={selectedDate ? selectedDate.toISOString() : new Date().toISOString()}
                          />
                          <input type="hidden" name="excludedPlaylists" value={searchParams.get("excludedPlaylists") || ""} />
                          <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                              <Label htmlFor="date-picker" className="text-right">
                                Before Date
                              </Label>
                              <div className="col-span-3">
                                <DatePicker
                                  date={selectedDate}
                                  setDate={setSelectedDate}
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                              <Label htmlFor="onlyMyPlaylists" className="text-right">
                                Filter
                              </Label>
                              <div className="flex items-center space-x-2 col-span-3">
                                <Checkbox
                                  id="onlyMyPlaylists"
                                  name="onlyMyPlaylists"
                                  value="true"
                                  checked={onlyMyPlaylists}
                                  onCheckedChange={(checked) => {
                                    setOnlyMyPlaylists(checked === true);
                                  }}
                                />
                                <label
                                  htmlFor="onlyMyPlaylists"
                                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                >
                                  Only my playlists
                                </label>
                              </div>
                            </div>
                          </div>
                          <DialogFooter>
                            <Button
                              type="submit"
                              disabled={isSubmittingAction("mark-as-downloaded")}
                            >
                              {isSubmittingAction("mark-as-downloaded") ? (
                                <Loader className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                "Mark as Downloaded"
                              )}
                            </Button>
                          </DialogFooter>
                        </Form>
                      </DialogContent>
                    </Dialog>
                    
                    <Form method="post" className="flex-shrink-0">
                      <input type="hidden" name="action" value="download-all" />
                      <input type="hidden" name="platform" value={searchParams.get("platform") || "all"} />
                      <input type="hidden" name="playlist" value={searchParams.get("playlist") || "all"} />
                      <input type="hidden" name="search" value={searchParams.get("search") || ""} />
                      <input type="hidden" name="onlyMyPlaylists" value={searchParams.get("onlyMyPlaylists") || "false"} />
                      <input type="hidden" name="excludedPlaylists" value={searchParams.get("excludedPlaylists") || ""} />
                      <Button
                        type="submit"
                        variant="default"
                        disabled={isSubmittingAction("download-all") || total === 0}
                        title={total === 0 ? "No songs to download" : `Download all ${total} filtered songs`}
                        className="whitespace-nowrap"
                      >
                        {isSubmittingAction("download-all") ? (
                          <Loader className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Package className="mr-2 h-4 w-4" />
                        )}
                        Add All ({total}) to Download
                      </Button>
                    </Form>
                  </div>
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
                <CardContent className="p-4">
                  <div className="mb-4 text-sm text-muted-foreground">
                    Showing {songs.length} of {total} songs matching your filters
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead className="w-40">Artist</TableHead>
                        <TableHead className="w-40">Album</TableHead>
                        <TableHead>Platform</TableHead>
                        <TableHead>Playlists</TableHead>
                        <TableHead>Added At</TableHead>

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
                            {song.playlists && song.playlists.length > 0 ? (
                              <div className="max-w-[400px] truncate">
                                {song.playlists.map(playlist => playlist.name).join(", ")}
                              </div>
                            ) : (
                              <span className="text-muted-foreground italic">None</span>
                            )}
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
      </div>
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