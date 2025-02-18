import { ActionFunction, json, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSearchParams, Form } from "@remix-run/react";
import { getUserSongsFromDB } from "~/services/db.server";
import { Song } from "~/types/customs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";

import { downloadSpotifySong } from "~/services/selfApi.server";
import {
  Card,
  CardContent,
} from "~/components/ui/card";
import { Pagination, PaginationContent, PaginationItem, PaginationPrevious, PaginationLink, PaginationNext } from "~/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { DownloadIcon, RefreshCw } from "lucide-react";
import fs from "fs/promises";
import path from "path";
import { createReadStream, readFileSync } from "fs";


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
  const sortBy = url.searchParams.get("sortBy") || "platform_added_at";
  const sortDirection = url.searchParams.get("sortDirection") || "desc";

  const { songs, currentPage, totalPages } = await getUserSongsFromDB(request, {
    page,
    itemsPerPage,
    search,
    platform,
    playlist,
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

export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const songName = formData.get("songName") as string;
  const artists = formData.getAll("artist") as string[];
  const playlistName = formData.get("playlistName") as string;

  try {
    const filePath = await downloadSpotifySong(songName, artists, playlistName);
    console.log("File downloaded to:", filePath);

    // Verify file exists and is accessible
    const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
    if (!fileExists) {
      throw new Error(`File not found at path: ${filePath}`);
    }

    const fileName = path.basename(filePath);
    const stats = await fs.stat(filePath);
    
    // Read file synchronously
    const fileContent = createReadStream(filePath);
    console.log("File size:", stats.size, "bytes");

    // Create response before deleting the file
    const response = new Response(fileContent, {
      status: 200,
      headers: {
        "Content-Type": "audio/flac",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
        "Content-Length": stats.size.toString(),
        "Access-Control-Expose-Headers": "Content-Disposition",
        "Cache-Control": "no-store",
      },
    });

    // Delete file after a short delay to ensure response is sent
    setTimeout(async () => {
      try {
        await fs.unlink(filePath);
        console.log("File deleted:", filePath);
      } catch (err) {
        console.error("Error deleting file:", err);
      }
    }, 1000);

    return response;
  } catch (error) {
    console.error("Download error:", error);
    return json({ 
      success: false, 
      error: String(error),
      details: error instanceof Error ? error.stack : undefined 
    }, { status: 500 });
  }
};

export default function Updates() {
  const { songs, currentPage, totalPages } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

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
            <Form action="/tracks/refresh" method="post">
              <Button type="submit" variant="outline">
                <RefreshCw className="mr-2 h-4 w-4" />
                Sync Library
              </Button>
            </Form>
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
                <TableRow key={song.id}>
                  <TableCell>
                    {song.album_image && (
                      <img
                        src={song.album_image}
                        alt={`${song.album} cover`}
                        className="w-16 h-16 rounded-sm object-cover"
                      />
                    )}
                  </TableCell>
                  <TableCell>{song.title}</TableCell>
                  <TableCell>
                    {song.artist_name?.join(", ") || ""}
                  </TableCell>
                  <TableCell>{song.platform}</TableCell>
                  <TableCell>{song.playlist}</TableCell>
                  <TableCell>{new Date(song.platform_added_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Form method="post">
                      <input type="hidden" name="songName" value={song.title || ""} />
                      {song.artist_name?.map((artist: string, index: number) => (
                        <input
                          key={index}
                          type="hidden"
                          name="artist"
                          value={artist}
                        />
                      ))}
                      <input type="hidden" name="playlistName" value={song.playlist || ""} />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"

                      >
                        <DownloadIcon className="h-4 w-4" />
                      </Button>
                    </Form>
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
