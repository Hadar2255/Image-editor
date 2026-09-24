import { DEFAULT_API_PORT } from '@raw/shared';
import { createApp } from './app.ts';

const port = Number(process.env.PORT) || DEFAULT_API_PORT;
// In production the server also serves the built client.
const app = createApp({ serveClient: process.env.NODE_ENV === 'production' });

app.listen(port, () => {
  console.log(`API server listening on http://localhost:${port}`);
});
