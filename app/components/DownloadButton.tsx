import { SquarePlus, Download, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "./ui/button";

interface DownloadButtonProps {
  songId: string;
  userId: string;
}

export function DownloadButton({ songId, userId }: DownloadButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLocal, setIsLocal] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  // Check if the file is available locally
  useEffect(() => {
    const checkLocalStatus = async () => {
      try {
        setIsChecking(true);
        const response = await fetch(`/api/check-local/${songId}?userId=${userId}`);
        const data = await response.json();
        setIsLocal(data.isLocal);
      } catch (err) {
        console.error("Error checking local status:", err);
        setIsLocal(false);
      } finally {
        setIsChecking(false);
      }
    };

    checkLocalStatus();
  }, [songId, userId]);

  const handleQueueDownload = async () => {
    try {
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
        disabled={isDownloading}
        variant="ghost"
        size="icon"
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