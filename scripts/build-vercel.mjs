// Produces a Vercel Build Output API (v3) bundle in .vercel/output:
//   static/        the built client
//   functions/api.func  the Express API bundled into one ESM file
//   config.json    routing + the COOP/COEP headers LibRaw-WASM needs
// Run after `npm run build` (the `build:vercel` script does both).
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

// Mirrors shared/src/isolation.ts (kept inline so this script runs on any Node version).
const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, '.vercel/output');
fs.rmSync(out, { recursive: true, force: true });

fs.cpSync(path.join(root, 'client/dist'), path.join(out, 'static'), { recursive: true });

const funcDir = path.join(out, 'functions/api.func');
await build({
  entryPoints: [path.join(root, 'server/src/vercel.ts')],
  outfile: path.join(funcDir, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // Express and friends are CommonJS; give the ESM bundle a real `require`.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
});
fs.writeFileSync(
  path.join(funcDir, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', maxDuration: 60 }, null, 2),
);

const config = {
  version: 3,
  routes: [
    { src: '/(.*)', headers: CROSS_ORIGIN_ISOLATION_HEADERS, continue: true },
    { src: '/assets/(.*)', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '/api/(.*)', dest: '/api?__path=$1' },
    { handle: 'filesystem' },
    { src: '/(.*)', dest: '/index.html' },
  ],
};
fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify(config, null, 2));
console.log(`Vercel output written to ${path.relative(root, out)}`);
