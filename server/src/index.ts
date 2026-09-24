import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { CROSS_ORIGIN_ISOLATION_HEADERS, DEFAULT_API_PORT } from '@raw/shared';

const app = express();
const port = Number(process.env.PORT) || DEFAULT_API_PORT;

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

// In production the server also serves the built client.
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  app.use(express.static(clientDist, { maxAge: '1h', index: false }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
});
