import { LoaderFunction } from "@remix-run/node";
import { registerDownloadStream, removeDownloadStream } from "~/workers/downloadWorker.server";

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");

  if (!userId) {
    return new Response("Missing user ID", { status: 400 });
  }

  console.log(`SSE connection established for user ${userId}`);

  return new Response(new ReadableStream({
    start(controller) {
      // Send initial connection message
      controller.enqueue('retry: 1000\n\n');
      controller.enqueue('event: open\ndata: {"connected":true,"userId":"' + userId + '"}\n\n');
      
      // Register this stream for the user
      registerDownloadStream(userId, controller);
      
      // Keep connection alive with comments
      const keepAlive = setInterval(() => {
        controller.enqueue(`: keepalive ${new Date().toISOString()}\n\n`);
      }, 15000);

      // Handle connection close
      request.signal.addEventListener('abort', () => {
        console.log(`SSE connection closed for user ${userId}`);
        clearInterval(keepAlive);
        removeDownloadStream(userId);
        controller.close();
      });
    },
  }), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Disable buffering for Nginx
    },
  });
}; 