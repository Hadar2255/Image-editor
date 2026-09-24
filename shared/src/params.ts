import { z } from 'zod';

/**
 * Edit parameters: the single source of truth for the sliders, the GPU
 * pipeline, Claude's JSON output and the .edit.json sidecar files.
 *
 * Every numeric field clamps to its range and falls back to its default when
 * missing or invalid, so parsing never throws on slightly-off input (older
 * sidecars, model output with an out-of-range value, ...).
 */

export interface Range {
  min: number;
  max: number;
  default: number;
  step: number;
}

const num = (min: number, max: number, def = 0, step = 1) => {
  const schema = z
    .number()
    .catch(def)
    .transform((v) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def))
    .default(def);
  return Object.assign(schema, { range: { min, max, default: def, step } as Range });
};

const point = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
export type CurvePoint = z.infer<typeof point>;
export const IDENTITY_CURVE: CurvePoint[] = [
  [0, 0],
  [1, 1],
];
const curve = z
  .array(point)
  .min(2)
  .max(16)
  .catch(IDENTITY_CURVE)
  .transform((pts) => normalizeCurve(pts))
  .default(IDENTITY_CURVE);

/** Sorts points by x and drops points sharing an x with a previous one. */
export function normalizeCurve(pts: CurvePoint[]): CurvePoint[] {
  const sorted = [...pts].sort((a, b) => a[0] - b[0]);
  const out = sorted.filter((p, i) => i === 0 || p[0] - sorted[i - 1][0] > 1e-4);
  return out.length >= 2 ? out : IDENTITY_CURVE;
}

export const HSL_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
export type HslBand = (typeof HSL_BANDS)[number];

const hslEntry = z
  .object({ hue: num(-100, 100), sat: num(-100, 100), lum: num(-100, 100) })
  .default({ hue: 0, sat: 0, lum: 0 });

export const WhiteBalanceSchema = z
  .object({
    /** Relative to the camera's as-shot white balance. + is warmer. */
    temp: num(-100, 100),
    /** + is more magenta, - is more green. */
    tint: num(-100, 100),
  })
  .default({ temp: 0, tint: 0 });

export const LightSchema = z
  .object({
    exposure: num(-5, 5, 0, 0.01),
    contrast: num(-100, 100),
    highlights: num(-100, 100),
    shadows: num(-100, 100),
    whites: num(-100, 100),
    blacks: num(-100, 100),
  })
  .default({ exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 });

export const CurveSchema = z
  .object({ luma: curve, red: curve, green: curve, blue: curve })
  .default({ luma: IDENTITY_CURVE, red: IDENTITY_CURVE, green: IDENTITY_CURVE, blue: IDENTITY_CURVE });

export const ColorSchema = z
  .object({ vibrance: num(-100, 100), saturation: num(-100, 100) })
  .default({ vibrance: 0, saturation: 0 });

export const HslSchema = z
  .object(Object.fromEntries(HSL_BANDS.map((b) => [b, hslEntry])) as Record<HslBand, typeof hslEntry>)
  .default(Object.fromEntries(HSL_BANDS.map((b) => [b, { hue: 0, sat: 0, lum: 0 }])) as Record<
    HslBand,
    { hue: number; sat: number; lum: number }
  >);

export const DetailSchema = z
  .object({
    sharpen: num(0, 150, 0),
    sharpenRadius: num(0.5, 3, 1, 0.1),
    sharpenDetail: num(0, 100, 25),
    noiseLuma: num(0, 100, 0),
    noiseColor: num(0, 100, 25),
  })
  .default({ sharpen: 0, sharpenRadius: 1, sharpenDetail: 25, noiseLuma: 0, noiseColor: 25 });

const cropRect = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0.05).max(1),
    h: z.number().min(0.05).max(1),
  })
  .refine((r) => r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001);
export type CropRect = z.infer<typeof cropRect>;

export const GeometrySchema = z
  .object({
    /** Straighten angle in degrees (+ = clockwise). The image is scaled to hide empty corners. */
    angle: num(-45, 45, 0, 0.1),
    /** Normalized crop of the straightened frame; null = no crop. */
    crop: cropRect.nullable().catch(null).default(null),
  })
  .default({ angle: 0, crop: null });

export const EDIT_PARAMS_VERSION = 1;

export const EditParamsSchema = z.object({
  version: z.literal(EDIT_PARAMS_VERSION).catch(EDIT_PARAMS_VERSION).default(EDIT_PARAMS_VERSION),
  wb: WhiteBalanceSchema,
  light: LightSchema,
  curve: CurveSchema,
  color: ColorSchema,
  hsl: HslSchema,
  detail: DetailSchema,
  geometry: GeometrySchema,
});

export type EditParams = z.infer<typeof EditParamsSchema>;
export type WhiteBalance = EditParams['wb'];
export type Light = EditParams['light'];
export type Detail = EditParams['detail'];

/** Parse anything (sidecar JSON, model output, partial objects) into valid params. */
export function parseEditParams(input: unknown): EditParams {
  return EditParamsSchema.parse(input ?? {});
}

export function defaultEditParams(): EditParams {
  return parseEditParams({});
}

/** Slider ranges, derived from the schema so UI and validation never disagree. */
export const RANGES = {
  wb: rangesOf(WhiteBalanceSchema),
  light: rangesOf(LightSchema),
  color: rangesOf(ColorSchema),
  detail: rangesOf(DetailSchema),
  hsl: { hue: hslEntry.unwrap().shape.hue.range, sat: hslEntry.unwrap().shape.sat.range, lum: hslEntry.unwrap().shape.lum.range },
  angle: GeometrySchema.unwrap().shape.angle.range,
} as const;

function rangesOf<S extends z.ZodDefault<z.ZodObject<Record<string, { range: Range } & z.ZodType>>>>(schema: S) {
  const shape = schema.unwrap().shape as Record<string, { range: Range }>;
  return Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, v.range])) as {
    [K in keyof S['_output']]: Range;
  };
}

export function paramsEqual(a: EditParams, b: EditParams): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
