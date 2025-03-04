import { useState, useEffect } from "react";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { X, Download } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";

interface DownloadJob {
  id: string;
  songName: string;
  progress: number;
  status: 'queued' | 'downloading' | 'completed' | 'error';
  error?: string;
  filePath?: string;
}

export function DownloadManager({ userId }: { userId: string }) {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!userId) return;

    const eventSource = new EventSource(`/api/download-progress?userId=${userId}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'queued') {
        setJobs(prevJobs => {
          if (prevJobs.some(job => job.id === data.jobId)) {
            return prevJobs;
          }
          return [...prevJobs, {
            id: data.jobId,
            songName: data.songName,
            progress: 0,
            status: 'queued'
          }];
        });
      } else if (data.type === 'progress') {
        setJobs(prevJobs => {
          const jobIndex = prevJobs.findIndex(job => job.id === data.jobId);
          if (jobIndex === -1) return prevJobs;

          const updatedJobs = [...prevJobs];
          updatedJobs[jobIndex] = {
            ...updatedJobs[jobIndex],
            status: 'downloading',
            progress: data.progress
          };
          return updatedJobs;
        });
      } else if (data.type === 'complete') {
        setJobs(prevJobs => {
          const jobIndex = prevJobs.findIndex(job => job.id === data.jobId);
          if (jobIndex === -1) return prevJobs;

          const updatedJobs = [...prevJobs];
          updatedJobs[jobIndex] = {
            ...updatedJobs[jobIndex],
            status: 'completed',
            progress: 100,
            filePath: data.filePath
          };
          return updatedJobs;
        });
      } else if (data.type === 'error') {
        setJobs(prevJobs => {
          const jobIndex = prevJobs.findIndex(job => job.id === data.jobId);
          if (jobIndex === -1) return prevJobs;

          const updatedJobs = [...prevJobs];
          updatedJobs[jobIndex] = {
            ...updatedJobs[jobIndex],
            status: 'error',
            error: data.error
          };
          return updatedJobs;
        });
      }
    };

    eventSource.onerror = () => {
      console.error('EventSource failed');
    };

    return () => {
      eventSource.close();
    };
  }, [userId]);

  const handleDownload = async (jobId: string) => {
    try {
      const response = await fetch(`/api/download/${jobId}`);
      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      const filename = filenameMatch ? filenameMatch[1] : 'download.flac';

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      // Remove the completed job from the list
      setJobs(prevJobs => prevJobs.filter(job => job.id !== jobId));
    } catch (error) {
      console.error('Download error:', error);
    }
  };

  const removeJob = (jobId: string) => {
    setJobs(prevJobs => prevJobs.filter(job => job.id !== jobId));
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative"
        >
          <Download className="h-4 w-4" />
          {jobs.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground rounded-full w-4 h-4 text-xs flex items-center justify-center">
              {jobs.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Downloads</h3>
            {jobs.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setJobs([])}
              >
                Clear all
              </Button>
            )}
          </div>
          {jobs.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm">No active downloads</p>
          ) : (
            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {jobs.map((job) => (
                <div key={job.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-sm">{job.songName}</h4>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => removeJob(job.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <Progress value={job.progress} className="h-1.5" />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {job.status === 'queued' && 'Queued'}
                      {job.status === 'downloading' && `${Math.round(job.progress)}%`}
                      {job.status === 'completed' && 'Completed'}
                      {job.status === 'error' && (
                        <span className="text-destructive">{job.error}</span>
                      )}
                    </span>
                    {job.status === 'completed' && job.filePath && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => handleDownload(job.id)}
                      >
                        <Download className="h-3 w-3 mr-1" />
                        Download
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
} 