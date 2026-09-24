// End-to-end smoke test: builds nothing, expects `npm run dev` to be running
// (or set APP_URL). Opens a real RAW file and checks it gets developed.
//   RAW_SAMPLE=/path/to/file.ARW npm run test:e2e
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const SAMPLE_URL = 'https://raw.githubusercontent.com/ybouane/LibRaw-Wasm/main/example-sony.ARW';
const outDir = path.resolve('e2e/output');
fs.mkdirSync(outDir, { recursive: true });

async function samplePath() {
  if (process.env.RAW_SAMPLE) return process.env.RAW_SAMPLE;
  const cached = path.join(outDir, 'example-sony.ARW');
  if (!fs.existsSync(cached)) {
    console.log(`Downloading sample RAW from ${SAMPLE_URL}…`);
    const res = await fetch(SAMPLE_URL);
    if (!res.ok) throw new Error(`Sample download failed: ${res.status}`);
    fs.writeFileSync(cached, Buffer.from(await res.arrayBuffer()));
  }
  return cached;
}

const launchOptions = {
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
};
if (fs.existsSync('/opt/pw-browsers/chromium')) launchOptions.executablePath = '/opt/pw-browsers/chromium';

const file = await samplePath();
const browser = await chromium.launch(launchOptions).catch(() => chromium.launch({ args: launchOptions.args }));
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

try {
  await page.goto(APP_URL);
  if (!(await page.evaluate(() => crossOriginIsolated))) throw new Error('Page is not cross-origin isolated');

  const t0 = Date.now();
  await page.setInputFiles('input[type=file]', file);
  await page.waitForSelector('.film-thumb img', { timeout: 60_000 });
  console.log(`thumbnail after ${Date.now() - t0} ms`);
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('[data-testid=viewer-canvas]')).opacity === '1',
    null,
    { timeout: 120_000 },
  );
  console.log(`developed preview after ${Date.now() - t0} ms`);

  const info = await page.$$eval('.info-row', (rows) => rows.map((r) => r.innerText.replace('\n', ': ')));
  console.log(info.join('\n'));

  // The rendered image must not be blank: sample the canvas centre.
  const stats = await page.evaluate(() => {
    const c = document.querySelector('[data-testid=viewer-canvas]');
    const gl = c.getContext('webgl2');
    const px = new Uint8Array(4 * 64 * 64);
    gl.readPixels((c.width >> 1) - 32, (c.height >> 1) - 32, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0, min = 255, max = 0;
    for (let i = 0; i < px.length; i += 4) {
      const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
      sum += l; min = Math.min(min, l); max = Math.max(max, l);
    }
    return { mean: sum / (px.length / 4), min, max };
  });
  console.log('centre luminance', stats);
  if (stats.max - stats.min < 5) throw new Error('Rendered image looks blank');

  await page.screenshot({ path: path.join(outDir, 'smoke.png') });
  if (errors.length) throw new Error(`Page errors:\n${errors.join('\n')}`);
  console.log('E2E smoke test passed ✔  (screenshot: e2e/output/smoke.png)');
} finally {
  await browser.close();
}
