import { SquarePlus, Download, Loader2 } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Button } from "./ui/button";

interface DownloadButtonProps {
  songId: string;
  userId?: string;
}

export function DownloadButton({ songId, userId }: DownloadButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLocal, setIsLocal] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Check if the file is available locally
  useEffect(() => {
    // Clear any existing timeout when component mounts or dependencies change
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setIsChecking(true);
    
    // Skip the check if userId is not available
    if (!userId) {
      setIsLocal(false);
      setIsChecking(false);
      return;
    }
    
    // Set a timeout to delay the check by 500ms
    timeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/check-local/${songId}?userId=${userId}`);
        const data = await response.json();
        setIsLocal(data.isLocal);
      } catch (err) {
        console.error("Error checking local status:", err);
        setIsLocal(false);
      } finally {
        setIsChecking(false);
      }
    }, 500); // 500ms delay before checking

    // Cleanup function to clear the timeout if component unmounts
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [songId, userId]);

  const handleQueueDownload = async () => {
    try {
      // Validate userId is available
      if (!userId) {
        setError("User ID is required for download");
        return;
      }
      
      setIsDownloading(true);
      setError(null);

      const response = await fetch("/api/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          songId,
          userId,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Download failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDirectDownload = async () => {
    try {
      // Validate userId is available
      if (!userId) {
        setError("User ID is required for download");
        return;
      }
      
      setIsDownloading(true);
      setError(null);

      // Create a hidden anchor element to trigger the download
      const a = document.createElement('a');
      a.href = `/api/direct-download/${songId}?userId=${userId}`;
      a.download = 'song.flac'; // The server will override this with the correct filename
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setIsDownloading(false);
    }
  };

  if (isChecking) {
    return (
      <div className="flex flex-col items-center gap-2">
        <Button
          disabled
          variant="ghost"
          size="icon"
        >
          <Loader2 className="w-4 h-4 animate-spin" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        onClick={isLocal ? handleDirectDownload : handleQueueDownload}
        disabled={isDownloading || !userId}
        variant="ghost"
        size="icon"
        title={!userId ? "User ID is required for download" : undefined}
      >
        {isDownloading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : isLocal ? (
          <Download className="w-4 h-4" />
        ) : (
          <SquarePlus className="w-4 h-4" />
        )}
      </Button>

      {error && (
        <p className="text-red-500 text-sm mt-2">{error}</p>
      )}
    </div>
  );
} 