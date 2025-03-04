import { LoaderFunction } from "@remix-run/node";
import { registerDownloadStream, removeDownloadStream } from "~/workers/downloadWorker.server";

export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");

  if (!userId) {
    return new Response("Missing user ID", { status: 400 });
  }

  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue('retry: 1000\n\n');
      
      // Register this stream for the user
      registerDownloadStream(userId, controller);
      
      // Keep connection alive
      const keepAlive = setInterval(() => {
        controller.enqueue(`: keepalive\n\n`);
      }, 15000);

      request.signal.addEventListener('abort', () => {
        clearInterval(keepAlive);
        removeDownloadStream(userId);
        controller.close();
      });
    },
  }), {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}; 