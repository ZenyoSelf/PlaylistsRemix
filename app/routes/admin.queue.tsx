import type { LoaderFunction } from '@remix-run/node';
import { bullBoardMiddleware } from '~/services/queue.server';

export const loader: LoaderFunction = async ({ request }) => {
  // Remove the /admin/queue prefix from the request URL
  const url = new URL(request.url);
  const pathname = url.pathname.replace('/admin/queue', '');
  
  // Create a new request with the modified URL
  const newRequest = new Request(new URL(pathname, url.origin), request);
  
  // Pass the request through the Bull Board middleware
  return await new Promise((resolve) => {
    bullBoardMiddleware(newRequest as any, {
      json: resolve,
      setHeader: () => {},
    } as any, () => {});
  });
}; 