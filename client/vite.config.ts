import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { CROSS_ORIGIN_ISOLATION_HEADERS, DEFAULT_API_PORT } from '../shared/src/isolation.ts';

const apiPort = Number(process.env.PORT) || DEFAULT_API_PORT;

export default defineConfig({
  plugins: [react()],
  server: {
    headers: CROSS_ORIGIN_ISOLATION_HEADERS,
    proxy: { '/api': `http://localhost:${apiPort}` },
  },
  preview: { headers: CROSS_ORIGIN_ISOLATION_HEADERS },
  // libraw-wasm spawns its worker and loads its .wasm via `new URL(..., import.meta.url)`;
  // pre-bundling would break those relative URLs.
  optimizeDeps: { exclude: ['libraw-wasm'] },
  worker: { format: 'es' },
});
