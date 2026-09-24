/**
 * LibRaw-WASM runs multi-threaded (pthreads over SharedArrayBuffer), which
 * browsers only allow on cross-origin-isolated pages. Both the Vite dev
 * server and the production Express server send these headers.
 */
export const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
} as const;

export const DEFAULT_API_PORT = 8787;
