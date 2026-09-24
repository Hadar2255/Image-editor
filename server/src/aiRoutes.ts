import { timingSafeEqual } from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { parseEditParams } from '@raw/shared';
import { analyzePhoto, ClaudeResponseError, ClaudeUnavailableError, instructEdit } from './claude/client.ts';
import { toCropSuggestion, toEditParams } from './claude/schema.ts';

/**
 * Optional shared password: when APP_PASSWORD is set, the AI endpoints need a
 * matching `x-app-password` header, so a public deployment can't be used to
 * spend your API credits.
 */
export function requirePassword(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return next();
  const given = Buffer.from(String(req.get('x-app-password') ?? ''));
  const want = Buffer.from(expected);
  if (given.length === want.length && timingSafeEqual(given, want)) return next();
  res.status(401).json({ error: 'Password required', code: 'password' });
}

/** Small fixed-window limiter per client IP (per server instance). */
export function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    if (++entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      res.status(429).json({ error: 'Too many requests, try again in a few minutes' });
      return;
    }
    next();
  };
}

const base64Jpeg = z
  .string()
  .max(4_000_000)
  .transform((s) => s.replace(/^data:image\/jpeg;base64,/, ''))
  .refine((s) => /^[A-Za-z0-9+/=]+$/.test(s.slice(0, 1000)), 'image must be base64 JPEG');

const AnalyzeBody = z.object({
  image: base64Jpeg,
  meta: z.record(z.string(), z.unknown()).default({}),
  stats: z.record(z.string(), z.unknown()).default({}),
  suggestion: z.unknown().optional(),
});

const InstructBody = z.object({
  image: base64Jpeg,
  params: z.unknown(),
  instruction: z.string().trim().min(1).max(600),
});

function handleError(res: Response, err: unknown) {
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', details: err.issues });
  if (err instanceof ClaudeUnavailableError) return res.status(503).json({ error: err.message, code: 'unconfigured' });
  if (err instanceof ClaudeResponseError) return res.status(502).json({ error: err.message });
  if (err instanceof Anthropic.AuthenticationError) {
    return res.status(502).json({ error: 'The server API key was rejected by Anthropic' });
  }
  if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'Claude is rate limited, try again shortly' });
  if (err instanceof Anthropic.APIConnectionTimeoutError) return res.status(504).json({ error: 'Claude took too long to answer' });
  if (err instanceof Anthropic.APIError) return res.status(502).json({ error: `Claude API error (${err.status ?? 'network'})` });
  console.error(err);
  return res.status(500).json({ error: 'Unexpected server error' });
}

export function aiRouter() {
  const router = Router();
  router.use(requirePassword, rateLimit(40, 10 * 60_000));

  router.post('/analyze', async (req, res) => {
    try {
      const body = AnalyzeBody.parse(req.body);
      const edit = await analyzePhoto({
        imageBase64: body.image,
        meta: body.meta,
        stats: body.stats,
        histogramSuggestion: parseEditParams(body.suggestion),
      });
      res.json({
        params: toEditParams(edit),
        sceneType: edit.sceneType,
        reasoning: edit.reasoning,
        geometry: {
          angle: Math.abs(edit.straightenAngle) >= 0.2 ? Math.max(-45, Math.min(45, edit.straightenAngle)) : 0,
          crop: toCropSuggestion(edit.crop),
        },
      });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/instruct', async (req, res) => {
    try {
      const body = InstructBody.parse(req.body);
      const current = parseEditParams(body.params);
      const edit = await instructEdit({ imageBase64: body.image, params: current, instruction: body.instruction });
      res.json({ params: toEditParams(edit, current), explanation: edit.explanation });
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}
