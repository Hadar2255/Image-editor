import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app.ts';

const app = createApp();

/**
 * Vercel entry point. The routing config sends /api/<path> here as
 * /api?__path=<path>; restore the original URL before Express sees it.
 */
export default function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const original = url.searchParams.get('__path');
  if (original !== null) {
    url.searchParams.delete('__path');
    req.url = `/api/${original}${url.search}`;
  }
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
