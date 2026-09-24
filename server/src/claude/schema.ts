import { z } from 'zod';
import { HSL_BANDS, parseEditParams, type CropRect, type EditParams } from '@raw/shared';

/**
 * The JSON shape Claude must return (structured outputs). Kept deliberately
 * flat and fully required; ranges live in the descriptions because numeric
 * constraints aren't enforced by structured outputs. Values are clamped
 * afterwards by the shared EditParams schema.
 */
const n = (description: string) => z.number().describe(description);
const bipolar = (what: string) => n(`${what}, -100..100, 0 = unchanged`);

const hslBand = z.object({ hue: bipolar('hue shift'), sat: bipolar('saturation'), lum: bipolar('luminance') });

export const SCENE_TYPES = [
  'portrait', 'landscape', 'cityscape', 'architecture', 'night', 'astro', 'food', 'product', 'street',
  'wildlife', 'macro', 'interior', 'event', 'sports', 'sunset', 'snow', 'beach', 'other',
] as const;

export const ModelEditSchema = z.object({
  sceneType: z.enum(SCENE_TYPES),
  reasoning: z.string().describe('2-4 short sentences: what you see and the intent of the edit, written for the photographer'),
  wb: z.object({ temp: bipolar('temperature relative to as-shot, + warmer'), tint: bipolar('tint, + magenta, - green') }),
  light: z.object({
    exposure: n('EV, -5..5'),
    contrast: bipolar('contrast'),
    highlights: bipolar('highlights (negative recovers bright areas)'),
    shadows: bipolar('shadows (positive opens dark areas)'),
    whites: bipolar('white point'),
    blacks: bipolar('black point'),
  }),
  color: z.object({ vibrance: bipolar('vibrance'), saturation: bipolar('saturation') }),
  hsl: z.object(Object.fromEntries(HSL_BANDS.map((b) => [b, hslBand])) as Record<(typeof HSL_BANDS)[number], typeof hslBand>),
  toneCurve: z
    .array(z.object({ x: n('input 0..1'), y: n('output 0..1') }))
    .describe('Luma curve points in display (gamma) space, including (0,y0) and (1,y1). [{x:0,y:0},{x:1,y:1}] = no change'),
  detail: z.object({
    sharpen: n('0..150'),
    sharpenRadius: n('0.5..3'),
    sharpenDetail: n('0..100'),
    noiseLuma: n('luminance noise reduction 0..100'),
    noiseColor: n('colour noise reduction 0..100'),
  }),
  straightenAngle: n('degrees to rotate to level the horizon/verticals, + = clockwise, 0 if already level'),
  crop: z
    .object({ x: n('left 0..1'), y: n('top 0..1'), w: n('width 0..1'), h: n('height 0..1') })
    .nullable()
    .describe('Suggested crop as fractions of the frame, or null if the framing is already good'),
});
export type ModelEdit = z.infer<typeof ModelEditSchema>;

export const InstructSchema = ModelEditSchema.omit({ sceneType: true, reasoning: true, straightenAngle: true, crop: true }).extend({
  explanation: z.string().describe('One or two short sentences, in the language of the request, saying what you changed'),
});
export type InstructEdit = z.infer<typeof InstructSchema>;

type AdjustmentFields = Pick<ModelEdit, 'wb' | 'light' | 'color' | 'hsl' | 'toneCurve' | 'detail'>;

/** Model output -> validated, clamped EditParams (geometry comes from `base`). */
export function toEditParams(m: AdjustmentFields, base?: EditParams): EditParams {
  return parseEditParams({
    wb: m.wb,
    light: m.light,
    color: m.color,
    hsl: m.hsl,
    curve: { ...base?.curve, luma: m.toneCurve.map((p) => [clamp01(p.x), clamp01(p.y)]) },
    detail: m.detail,
    geometry: base?.geometry,
  });
}

/** Sanitize a suggested crop; null when it's degenerate or basically the full frame. */
export function toCropSuggestion(c: ModelEdit['crop']): CropRect | null {
  if (!c) return null;
  const x = clamp01(c.x);
  const y = clamp01(c.y);
  const w = Math.min(clamp01(c.w), 1 - x);
  const h = Math.min(clamp01(c.h), 1 - y);
  if (w < 0.2 || h < 0.2 || (w > 0.97 && h > 0.97)) return null;
  return { x, y, w, h };
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
