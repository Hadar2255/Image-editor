import { defaultEditParams, type EditParams, type Light } from '@raw/shared';
import { toneFunction } from '../develop/toneLut.ts';
import type { ImageStats } from './stats.ts';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Smallest/largest slider value (integer) for which `f(value)` reaches `target`, by bisection. */
function solveMonotonic(f: (v: number) => number, target: number, lo: number, hi: number, increasing: boolean): number {
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const below = f(mid) < target;
    if (below === increasing) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

/**
 * Histogram-based automatic edit: what a careful photographer does first,
 * derived from statistics alone. Used immediately on load and as the
 * fallback when Claude isn't available.
 */
export function histogramAutoEdit(stats: ImageStats, meta?: { iso?: number }): EditParams {
  const params = defaultEditParams();
  const { p } = stats;

  // Exposure: bring the scene key towards middle grey without blowing the top 1%.
  let ev = Math.log2(0.16 / Math.max(stats.geoMean, 1e-5));
  ev = Math.min(ev, Math.log2(1 / Math.max(p.p99, 1e-5)) + 0.3);
  ev = clamp(ev, -2.5, 2.0);
  const scaled = (v: number) => v * Math.pow(2, ev);

  // Tonal balance: recover what sits high, open what sits low.
  const brightShare = fractionAbove(stats, 0.5 / Math.pow(2, ev));
  const darkShare = fractionBelow(stats, 0.03 / Math.pow(2, ev));
  const light: Light = {
    exposure: Math.round(ev * 100) / 100,
    contrast: 0,
    highlights: -Math.round(clamp(15 + brightShare * 150, 15, 70)),
    shadows: Math.round(clamp(10 + darkShare * 120, 5, 60)),
    whites: 0,
    blacks: 0,
  };
  const spread = Math.log2(Math.max(p.p95, 1e-5) / Math.max(p.p05, 1e-5));
  light.contrast = Math.round(clamp((8 - spread) * 6, -15, 30));

  // White/black points: stretch so the extremes land just inside the display range.
  const top = scaled(p.p995);
  const bottom = scaled(p.p001);
  light.whites = clamp(solveMonotonic((w) => toneFunction({ ...light, whites: w })(top), 0.95, -50, 60, true), -30, 40);
  light.blacks = clamp(solveMonotonic((b) => toneFunction({ ...light, blacks: b })(bottom), 0.003, -50, 30, true), -40, 15);
  params.light = light;

  // White balance: a conservative nudge towards neutral, from near-grey pixels only.
  if (stats.neutral) {
    const [r, g, b] = stats.neutral;
    const t = Math.log2(b / r) / 1.4;
    const d = Math.log2(Math.sqrt(r * b) / g);
    const tint = (0.1 * t - d) / 0.6;
    params.wb.temp = Math.round(clamp(t * 100 * 0.4, -25, 25));
    // Tint casts are rarer than temperature casts and foliage fools gray-world, so nudge less.
    params.wb.tint = Math.round(clamp(tint * 100 * 0.25, -12, 12));
  }

  params.color.vibrance = 15;

  // Detail by ISO.
  const iso = meta?.iso && meta.iso > 0 ? meta.iso : 100;
  const stops = Math.log2(iso / 100);
  params.detail.sharpen = 40;
  params.detail.noiseLuma = Math.round(clamp((stops - 1) * 8, 0, 50));
  params.detail.noiseColor = iso >= 3200 ? 40 : 25;
  return params;
}

/** Percentile interpolation over the stored quantiles (coarse but monotonic). */
function cdf(stats: ImageStats, v: number): number {
  const pts: [number, number][] = [
    [0, 0], [stats.p.p001, 0.001], [stats.p.p01, 0.01], [stats.p.p05, 0.05], [stats.p.p25, 0.25], [stats.p.p50, 0.5],
    [stats.p.p75, 0.75], [stats.p.p95, 0.95], [stats.p.p99, 0.99], [stats.p.p995, 0.995], [stats.p.p999, 0.999], [Infinity, 1],
  ];
  for (let i = 1; i < pts.length; i++) {
    const [x1, q1] = pts[i];
    if (v <= x1) {
      const [x0, q0] = pts[i - 1];
      if (!Number.isFinite(x1) || x1 === x0) return q1;
      return q0 + ((v - x0) / (x1 - x0)) * (q1 - q0);
    }
  }
  return 1;
}
const fractionAbove = (s: ImageStats, v: number) => 1 - cdf(s, v);
const fractionBelow = (s: ImageStats, v: number) => cdf(s, v);
