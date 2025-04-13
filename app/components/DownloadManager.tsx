import { useState, useEffect } from "react";
import { Button } from "~/components/ui/button";
import { Progress } from "~/components/ui/progress";
import { X, Download, RefreshCw } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";

interface DownloadJob {
  id: string | number;
  songName: string;
  progress: number;
  status: 'queued' | 'downloading' | 'completed' | 'error' | 'cancelled' | 'usercancelled';
  filePath?: string;
  error?: string;
  isBulk?: boolean;
  errorTime?: number;
  infoMessages?: { message: string; error?: string; time: number }[];
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
    
    // Add a connection status indicator
    console.log(`EventSource connected for user ${userId}`);
    
    eventSource.onopen = () => {
      console.log(`EventSource connection opened for user ${userId}`);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('SSE event received:', data);
        
        if (data.type === 'queued') {
          // Add new job to the list
          setJobs(prevJobs => [
            ...prevJobs.filter(job => job.id !== data.jobId), // Remove if already exists
            { 
              id: data.jobId, 
              progress: 0, 
              status: 'queued', 
              songName: data.songName || 'Unknown',
              isBulk: data.isBulk === true || data.jobId.toString().startsWith('bulk-') || data.songName.includes('Bulk download')
            }
          ]);
        } else if (data.type === 'progress') {
          setJobs(prevJobs => 
            prevJobs.map(job => 
              job.id === data.jobId 
                ? { 
                    ...job, 
                    progress: data.progress, 
                    status: 'downloading',
                    songName: data.songName || job.songName,
                    isBulk: job.isBulk || data.isBulk === true || data.jobId.toString().startsWith('bulk-') || data.songName.includes('Bulk download')
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
                    songName: data.songName || job.songName,
                    isBulk: job.isBulk || data.isBulk === true || data.jobId.toString().startsWith('bulk-') || data.songName.includes('Bulk download')
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
                    songName: data.songName || job.songName,
                    isBulk: job.isBulk || data.isBulk === true || data.jobId.toString().startsWith('bulk-') || data.songName.includes('Bulk download'),
                    errorTime: Date.now()
                  } 
                : job
            )
          );
        } else if (data.type === 'info') {
          // For info messages, we don't update the job status but we can show a toast or log
          console.log(`Info for job ${data.jobId}: ${data.songName}${data.error ? ` - ${data.error}` : ''}`);
          
          // Optionally, you could update the job with additional info
          setJobs(prevJobs => 
            prevJobs.map(job => 
              job.id === data.jobId 
                ? { 
                    ...job,
                    // Add info messages to an array on the job
                    infoMessages: [
                      ...(job.infoMessages || []),
                      {
                        message: data.songName,
                        error: data.error,
                        time: Date.now()
                      }
                    ]
                  } 
                : job
            )
          );
        }
      } catch (error) {
        console.error('Error processing event:', error, event.data);
      }
    };

    eventSource.onerror = (error) => {
      console.error('EventSource error:', error);
      // Try to reconnect after a delay instead of closing
      setTimeout(() => {
        eventSource.close();
        // The useEffect cleanup will run and a new connection will be established on the next render
        setJobs(prev => [...prev]); // Force a re-render
      }, 5000);
    };

    return () => {
      console.log(`Closing EventSource for user ${userId}`);
      eventSource.close();
    };
  }, [userId]);

  // Fetch active jobs from the queue
  const fetchActiveJobs = async () => {
    if (!userId) return;
    
    try {
      setIsLoading(true);
      console.log(`Fetching active jobs for user ${userId}`);
      const response = await fetch(`/api/active-jobs?userId=${userId}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch active jobs');
      }
      
      const data = await response.json();
      console.log(`Received ${data.jobs.length} active jobs:`, data.jobs);
      
      // Merge with existing jobs to avoid losing progress information
      setJobs(prevJobs => {
        const newJobs = data.jobs.map((job: {
          id: string;
          status: 'downloading' | 'queued' | 'completed';
          data: {
            songId?: string;
            userId: string;
            songName: string;
            type?: string;
            zipPath?: string;
          };
          progress: number;
          isBulk: boolean;
        }) => {
          // Find existing job to preserve any real-time progress updates
          const existingJob = prevJobs.find(j => j.id === job.id);
          
          // For bulk downloads, ensure progress is properly tracked
          const isBulk = job.isBulk || job.data.type === 'bulk' || job.id.toString().startsWith('bulk-');
          
          return {
            id: job.id,
            songName: job.data.songName || existingJob?.songName || 'Unknown Song',
            progress: existingJob?.progress || job.progress || 0,
            status: existingJob?.status === 'usercancelled' 
              ? 'usercancelled' 
              : (job.status || existingJob?.status || 'queued'),
            isBulk,
            filePath: job.data.zipPath || existingJob?.filePath,
            error: existingJob?.error
          };
        });
        
        // Keep existing jobs that aren't in the new list and aren't errors or cancelled
        // or are errors that haven't been acknowledged
        const existingJobIds = new Set(newJobs.map((job: { id: string }) => job.id));
        const filteredPrevJobs = prevJobs.filter(job => 
          (!existingJobIds.has(job.id) && job.status !== 'error' && job.status !== 'usercancelled') || 
          (job.status === 'error' && Date.now() - (job.errorTime || 0) < 60000)
        );
        
        return [...newJobs, ...filteredPrevJobs];
      });
    } catch (error) {
      console.error('Error fetching active jobs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async (jobId: string | number, isBulk: boolean = false) => {
    try {
      // Use different endpoint for bulk downloads
      const endpoint = isBulk 
        ? `/api/bulk-download/${String(jobId)}`
        : `/api/download/${String(jobId)}`;
        
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
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading file:', error);
      alert('Failed to download file. Please try again.');
    }
  };

  const removeJob = async (jobId: string | number) => {
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
    } else if (job.status === 'usercancelled') {
      return <div className="h-2 w-2 rounded-full bg-gray-500"></div>;
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
                  className="flex flex-col border-b p-3 last:border-0"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(job)}
                      <span className="font-medium  max-w-[240px]" title={job.songName}>
                        {job.isBulk ? "🗃️ " : ""}{job.songName}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => removeJob(job.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-2">
                    <Progress value={job.progress} className="h-2" />
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {job.status === 'queued'
                        ? 'Queued'
                        : job.status === 'downloading'
                        ? `${job.progress}%`
                        : job.status === 'completed'
                        ? 'Completed'
                        : job.status === 'usercancelled'
                        ? 'Cancelled'
                        : 'Error'}
                    </span>
                    {job.status === 'completed' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => handleDownload(job.id, job.isBulk)}
                      >
                        <Download className="mr-1 h-3 w-3" />
                        Download {job.isBulk ? "ZIP" : ""}
                      </Button>
                    )}
                    {job.status === 'error' && (
                      <span className="text-xs text-red-500">
                        {job.error || 'Unknown error'}
                      </span>
                    )}
                  </div>
                  
                  {/* Display the latest info message if available */}
                  {job.infoMessages && job.infoMessages.length > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground border-t pt-1 max-h-10 overflow-y-auto">
                      {job.infoMessages.slice(-3).map((info, idx) => (
                        <div key={idx} className={`${info.error ? "text-red-400" : "text-blue-400"} truncate`} title={info.message}>
                          {info.message}
                        </div>
                      ))}
                    </div>
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