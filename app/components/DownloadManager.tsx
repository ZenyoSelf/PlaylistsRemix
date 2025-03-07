import { useState, useEffect } from "react";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { X, Download, RefreshCw, Package } from "lucide-react";
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
  isBulk?: boolean;
}

export function DownloadManager({ userId }: { userId: string }) {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch active jobs when component mounts or popover opens
  useEffect(() => {
    if (isOpen) {
      fetchActiveJobs();
    }
  }, [isOpen, userId]);

  // Listen for download progress events
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
          
          // Check if this is a bulk download
          const isBulk = data.jobId.startsWith('bulk-') || data.songName.includes('Bulk download');
          
          return [...prevJobs, {
            id: data.jobId,
            songName: data.songName,
            progress: 0,
            status: 'queued',
            isBulk
          }];
        });
      } else if (data.type === 'progress') {
        setJobs(prevJobs => 
          prevJobs.map(job => 
            job.id === data.jobId 
              ? { 
                  ...job, 
                  progress: data.progress, 
                  status: 'downloading',
                  isBulk: job.isBulk || data.jobId.startsWith('bulk-') || data.songName.includes('Bulk download')
                } 
              : job
          )
        );
      } else if (data.type === 'complete') {
        setJobs(prevJobs => 
          prevJobs.map(job => 
            job.id === data.jobId 
              ? { 
                  ...job, 
                  progress: 100, 
                  status: 'completed', 
                  filePath: data.filePath,
                  isBulk: job.isBulk || data.jobId.startsWith('bulk-') || data.songName.includes('Bulk download')
                } 
              : job
          )
        );
      } else if (data.type === 'error') {
        setJobs(prevJobs => 
          prevJobs.map(job => 
            job.id === data.jobId 
              ? { 
                  ...job, 
                  status: 'error', 
                  error: data.error,
                  isBulk: job.isBulk || data.jobId.startsWith('bulk-') || data.songName.includes('Bulk download')
                } 
              : job
          )
        );
      }
    };

    eventSource.onerror = (error) => {
      console.error('EventSource error:', error);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [userId]);

  // Fetch active jobs from the queue
  const fetchActiveJobs = async () => {
    if (!userId) return;
    
    try {
      setIsLoading(true);
      const response = await fetch(`/api/active-jobs?userId=${userId}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch active jobs');
      }
      
      const data = await response.json();
      
      // Merge with existing jobs to avoid losing progress information
      setJobs(prevJobs => {
        const newJobs = data.jobs.map((job: {
          id: string;
          status: 'active' | 'queued' | 'delayed';
          data: {
            songId: string;
            userId: string;
            songName: string;
            type?: string;
          };
          progress: number;
        }) => ({
          id: job.id,
          songName: job.data.songName || 'Unknown Song',
          progress: job.progress || 0,
          status: job.status === 'active' ? 'downloading' : job.status,
          isBulk: job.id.startsWith('bulk-') || job.data.type === 'bulk' || (job.data.songName && job.data.songName.includes('Bulk download'))
        }));
        
        // Keep existing jobs that aren't in the new list
        const existingJobIds = new Set(newJobs.map((job: { id: string }) => job.id));
        const filteredPrevJobs = prevJobs.filter(job => 
          !existingJobIds.has(job.id) && job.status !== 'error'
        );
        
        return [...newJobs, ...filteredPrevJobs];
      });
    } catch (error) {
      console.error('Error fetching active jobs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async (jobId: string, isBulk: boolean = false) => {
    try {
      // Use different endpoint for bulk downloads
      const endpoint = isBulk 
        ? `/api/bulk-download/${jobId}`
        : `/api/download/${jobId}`;
        
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/);
      let filename = filenameMatch ? filenameMatch[1] : isBulk ? 'new-additions.zip' : 'download.flac';
      
      // Decode the URL-encoded filename
      try {
        filename = decodeURIComponent(filename);
      } catch (e) {
        console.warn('Error decoding filename:', e);
        // If decoding fails, use the original filename
      }

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

  const getStatusIcon = (job: DownloadJob) => {
    if (job.status === 'queued') {
      return <div className="h-2 w-2 rounded-full bg-yellow-500"></div>;
    } else if (job.status === 'downloading') {
      return <div className="h-2 w-2 rounded-full bg-blue-500"></div>;
    } else if (job.status === 'completed') {
      return <div className="h-2 w-2 rounded-full bg-green-500"></div>;
    } else if (job.status === 'error') {
      return <div className="h-2 w-2 rounded-full bg-red-500"></div>;
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          onClick={() => setIsOpen(true)}
        >
          <Download className="h-5 w-5" />
          {jobs.length > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
              {jobs.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h3 className="font-medium">Downloads</h3>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={fetchActiveJobs}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <div className="max-h-80 overflow-auto">
          {jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-6 text-center">
              <Download className="mb-2 h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No active downloads</p>
            </div>
          ) : (
            <div className="space-y-2 p-2">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex flex-col rounded-md border p-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {job.isBulk ? (
                        <Package className="h-4 w-4 text-primary" />
                      ) : (
                        <Download className="h-4 w-4 text-primary" />
                      )}
                      <span className="text-sm font-medium truncate max-w-[180px]" title={job.songName}>
                        {job.songName}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {getStatusIcon(job)}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => removeJob(job.id)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2">
                    <Progress value={job.progress} className="h-1" />
                  </div>
                  {job.status === 'completed' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 h-7 text-xs"
                      onClick={() => handleDownload(job.id, job.isBulk)}
                    >
                      <Download className="mr-1 h-3 w-3" />
                      Download
                    </Button>
                  )}
                  {job.status === 'error' && (
                    <p className="mt-1 text-xs text-red-500">
                      {job.error || 'Download failed'}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
} 