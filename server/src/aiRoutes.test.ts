import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HSL_BANDS } from '@raw/shared';

/**
 * Runs the real Express app and the real Anthropic SDK against a fake
 * Messages API, so request shape, structured-output parsing, clamping and
 * error mapping are all exercised without a network or an API key.
 */
let fakeReply: { status: number; body: unknown } = { status: 200, body: {} };
let lastRequest: any = null;
let fake: http.Server;
let app: http.Server;
let base = '';

const modelEdit = (overrides: Record<string, unknown> = {}) => ({
  sceneType: 'landscape',
  reasoning: 'Lush garden in soft light; lifting shadows and adding a touch of warmth.',
  wb: { temp: 8, tint: 2 },
  light: { exposure: 0.4, contrast: 15, highlights: -40, shadows: 35, whites: 10, blacks: -8 },
  color: { vibrance: 20, saturation: 0 },
  hsl: Object.fromEntries(HSL_BANDS.map((b) => [b, { hue: 0, sat: 0, lum: 0 }])),
  toneCurve: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  detail: { sharpen: 40, sharpenRadius: 1, sharpenDetail: 25, noiseLuma: 10, noiseColor: 25 },
  straightenAngle: 1.3,
  crop: null,
  ...overrides,
});

const message = (json: unknown, stop_reason = 'end_turn') => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5',
  content: [{ type: 'text', text: JSON.stringify(json) }],
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

const json = (r: Response): Promise<any> => r.json();

const TINY_JPEG = Buffer.from('ffd8ffe000104a464946', 'hex').toString('base64');

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      lastRequest = JSON.parse(data || '{}');
      res.writeHead(fakeReply.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fakeReply.body));
    });
  });
  await new Promise<void>((r) => fake.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const { createApp } = await import('./app.ts');
  app = createApp().listen(0);
  await new Promise<void>((r) => app.once('listening', r));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

afterAll(() => {
  fake.close();
  app.close();
});

beforeEach(() => {
  delete process.env.APP_PASSWORD;
  lastRequest = null;
});

describe('POST /api/ai/analyze', () => {
  it('sends the image with a structured-output schema and returns clamped params', async () => {
    fakeReply = { status: 200, body: message(modelEdit({ light: { exposure: 9, contrast: 15, highlights: -40, shadows: 35, whites: 10, blacks: -8 } })) };
    const res = await post('/api/ai/analyze', { image: TINY_JPEG, meta: { iso: 800 }, stats: {}, suggestion: {} });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.sceneType).toBe('landscape');
    expect(body.params.light.exposure).toBe(5); // clamped from 9
    expect(body.params.light.shadows).toBe(35);
    expect(body.geometry).toEqual({ angle: 1.3, crop: null });

    expect(lastRequest.model).toBe('claude-sonnet-5');
    expect(lastRequest.output_config.format.type).toBe('json_schema');
    expect(lastRequest.thinking).toEqual({ type: 'adaptive' });
    const image = lastRequest.messages[0].content[0];
    expect(image).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: TINY_JPEG } });
  });

  it('drops a degenerate crop suggestion and keeps a real one', async () => {
    fakeReply = { status: 200, body: message(modelEdit({ crop: { x: 0, y: 0, w: 1, h: 0.99 } })) };
    expect((await json(await post('/api/ai/analyze', { image: TINY_JPEG }))).geometry.crop).toBeNull();
    fakeReply = { status: 200, body: message(modelEdit({ crop: { x: 0.1, y: 0.05, w: 0.8, h: 0.9 } })) };
    expect((await json(await post('/api/ai/analyze', { image: TINY_JPEG }))).geometry.crop).toEqual({ x: 0.1, y: 0.05, w: 0.8, h: 0.9 });
  });

  it('maps a refusal and schema-violating output to 502', async () => {
    fakeReply = { status: 200, body: message({}, 'refusal') };
    expect((await post('/api/ai/analyze', { image: TINY_JPEG })).status).toBe(502);
    fakeReply = { status: 200, body: message({ sceneType: 'landscape' }) };
    expect((await post('/api/ai/analyze', { image: TINY_JPEG })).status).toBe(502);
  });

  it('rejects requests without an image', async () => {
    expect((await post('/api/ai/analyze', { meta: {} })).status).toBe(400);
  });

  it('enforces APP_PASSWORD when set', async () => {
    process.env.APP_PASSWORD = 'secret';
    fakeReply = { status: 200, body: message(modelEdit()) };
    expect((await post('/api/ai/analyze', { image: TINY_JPEG })).status).toBe(401);
    expect((await post('/api/ai/analyze', { image: TINY_JPEG }, { 'x-app-password': 'nope' })).status).toBe(401);
    expect((await post('/api/ai/analyze', { image: TINY_JPEG }, { 'x-app-password': 'secret' })).status).toBe(200);
  });
});

describe('POST /api/ai/instruct', () => {
  it('returns new params that keep the current geometry', async () => {
    const { toneCurve, sceneType, reasoning, straightenAngle, crop, ...rest } = modelEdit();
    void sceneType; void reasoning; void straightenAngle; void crop;
    fakeReply = { status: 200, body: message({ ...rest, toneCurve, explanation: 'Warmed it up.' }) };
    const res = await post('/api/ai/instruct', {
      image: TINY_JPEG,
      instruction: 'warmer please',
      params: { geometry: { angle: 2, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } } },
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.explanation).toBe('Warmed it up.');
    expect(body.params.wb.temp).toBe(8);
    expect(body.params.geometry).toEqual({ angle: 2, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } });
    expect(JSON.stringify(lastRequest.messages)).toContain('warmer please');
  });

  it('reports an upstream auth failure clearly', async () => {
    fakeReply = { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } };
    const res = await post('/api/ai/instruct', { image: TINY_JPEG, instruction: 'x', params: {} });
    expect(res.status).toBe(502);
    expect((await json(res)).error).toMatch(/API key/);
  });
});
