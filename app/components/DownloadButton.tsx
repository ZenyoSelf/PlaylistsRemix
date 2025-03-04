import { DownloadIcon } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "./ui/button";

interface DownloadButtonProps {
  songId: string;
  userId: string;
}

export function DownloadButton({ songId, userId }: DownloadButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);



  const handleDownload = async () => {
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
      setIsDownloading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <Button
        onClick={handleDownload}
        disabled={isDownloading}
        variant="ghost"
        size="icon"

      >
        <DownloadIcon className="w-4 h-4" />
       
      </Button>

      

      {
        error && (
          <p className="text-red-500 text-sm mt-2">{error}</p>
        )
      }
    </div >
  );
} 