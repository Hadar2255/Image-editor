// A stand-in for the Anthropic Messages API, for testing the AI flow without an API key:
//   node e2e/fake-anthropic.mjs            (listens on :9999)
//   ANTHROPIC_BASE_URL=http://localhost:9999 ANTHROPIC_API_KEY=fake npm run dev
// Replies with a fixed, clearly visible edit; requests are logged to e2e/output/fake-requests/.
import fs from 'node:fs';
import http from 'node:http';

const port = Number(process.env.FAKE_PORT || 9999);
const logDir = 'e2e/output/fake-requests';
fs.mkdirSync(logDir, { recursive: true });
const bands = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
const adjustments = {
  wb: { temp: 18, tint: 4 },
  light: { exposure: 0.55, contrast: 18, highlights: -45, shadows: 40, whites: 12, blacks: -10 },
  color: { vibrance: 25, saturation: 0 },
  hsl: Object.fromEntries(bands.map((b) => [b, { hue: b === 'green' ? -15 : 0, sat: b === 'green' ? -10 : 0, lum: 0 }])),
  toneCurve: [{ x: 0, y: 0 }, { x: 0.25, y: 0.22 }, { x: 0.75, y: 0.79 }, { x: 1, y: 1 }],
  detail: { sharpen: 45, sharpenRadius: 1, sharpenDetail: 25, noiseLuma: 15, noiseColor: 25 },
};
let n = 0;

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const request = JSON.parse(body || '{}');
      fs.writeFileSync(`${logDir}/${++n}.json`, JSON.stringify(request, null, 2));
      const isInstruct = JSON.stringify(request.output_config?.format ?? {}).includes('"explanation"');
      const payload = isInstruct
        ? { ...adjustments, wb: { temp: 35, tint: 6 }, color: { vibrance: 10, saturation: -15 }, explanation: 'Warmer tones and softer colours for a cinematic feel.' }
        : { ...adjustments, sceneType: 'landscape', reasoning: 'A shaded Japanese garden: opened the shadows, held the bright foliage, and warmed it slightly.', straightenAngle: 1.2, crop: { x: 0.04, y: 0.03, w: 0.92, h: 0.94 } };
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: `msg_fake_${n}`, type: 'message', role: 'assistant', model: request.model,
          content: [{ type: 'text', text: JSON.stringify(payload) }],
          stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
        }));
      }, 1500);
    });
  })
  .listen(port, () => console.log(`Fake Anthropic API on http://localhost:${port}`));
