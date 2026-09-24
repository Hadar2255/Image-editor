import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { CROSS_ORIGIN_ISOLATION_HEADERS } from '@raw/shared';

/** The API, shared by the local/production Node server and the Vercel function. */
export function createApp({ serveClient = false } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set(CROSS_ORIGIN_ISOLATION_HEADERS);
    next();
  });
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      claudeConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-5',
    });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (serveClient) {
    const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
    app.use(express.static(clientDist, { maxAge: '1h', index: false }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  return app;
}
