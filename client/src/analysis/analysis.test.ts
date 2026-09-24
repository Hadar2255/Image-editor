import { describe, expect, it } from 'vitest';
import type { LinearImage } from '../raw/rawLoader.ts';
import { computeStats, downsampleLuma } from './stats.ts';
import { histogramAutoEdit } from './autoAdjust.ts';
import { detectTilt } from './horizon.ts';

/** Synthetic linear image from a per-pixel function returning RGB in 0..1. */
function makeImage(w: number, h: number, f: (x: number, y: number) => [number, number, number]): LinearImage {
  const data = new Uint16Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y);
      const i = (y * w + x) * 3;
      data[i] = Math.round(Math.min(1, r) * 65535);
      data[i + 1] = Math.round(Math.min(1, g) * 65535);
      data[i + 2] = Math.round(Math.min(1, b) * 65535);
    }
  return { width: w, height: h, data };
}

const gradient = (scale: number, tint: [number, number, number] = [1, 1, 1]) =>
  makeImage(300, 200, (x, y) => {
    const v = scale * Math.pow(2, (x / 300) * 6 - 5) * (0.8 + 0.2 * (y / 200));
    return [v * tint[0], v * tint[1], v * tint[2]];
  });

describe('histogram auto edit', () => {
  it('brightens an underexposed photo and darkens an overexposed one', () => {
    const dark = histogramAutoEdit(computeStats(gradient(0.08)));
    const bright = histogramAutoEdit(computeStats(gradient(1.6)));
    expect(dark.light.exposure).toBeGreaterThan(1);
    expect(bright.light.exposure).toBeLessThan(dark.light.exposure);
    expect(bright.light.exposure).toBeLessThan(0.5);
  });

  it('warms a blue cast and cools an amber one', () => {
    const blue = histogramAutoEdit(computeStats(gradient(0.5, [0.85, 1, 1.25])));
    const amber = histogramAutoEdit(computeStats(gradient(0.5, [1.25, 1, 0.8])));
    expect(blue.wb.temp).toBeGreaterThan(3);
    expect(amber.wb.temp).toBeLessThan(-3);
  });

  it('leaves a neutral image near neutral white balance', () => {
    const e = histogramAutoEdit(computeStats(gradient(0.5)));
    expect(Math.abs(e.wb.temp)).toBeLessThanOrEqual(1);
    expect(Math.abs(e.wb.tint)).toBeLessThanOrEqual(1);
  });

  it('adds noise reduction for high ISO', () => {
    const stats = computeStats(gradient(0.5));
    expect(histogramAutoEdit(stats, { iso: 100 }).detail.noiseLuma).toBe(0);
    expect(histogramAutoEdit(stats, { iso: 6400 }).detail.noiseLuma).toBeGreaterThan(30);
  });

  it('always produces values inside the slider ranges', () => {
    for (const s of [0.001, 0.05, 0.5, 3]) {
      const e = histogramAutoEdit(computeStats(gradient(s)));
      for (const v of Object.values(e.light)) expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(e.light.exposure)).toBeLessThanOrEqual(5);
      expect(Math.abs(e.light.whites)).toBeLessThanOrEqual(100);
    }
  });
});

describe('horizon detection', () => {
  /** Sky above a tilted horizon line; + angle means the line drops towards the right. */
  const horizon = (deg: number) => {
    const t = Math.tan((deg * Math.PI) / 180);
    return makeImage(400, 300, (x, y) => (y < 150 + (x - 200) * t ? [0.5, 0.55, 0.7] : [0.05, 0.06, 0.04]));
  };

  it('suggests rotating a tilted horizon back to level', () => {
    // A horizon rising to the right (negative angle in y-down coords) needs a clockwise (+) turn.
    const a = detectTilt(downsampleLuma(horizon(-2.5)));
    expect(a).not.toBeNull();
    expect(a!).toBeGreaterThan(2);
    expect(a!).toBeLessThan(3);
    const b = detectTilt(downsampleLuma(horizon(3)));
    expect(b!).toBeLessThan(-2.5);
  });

  it('stays quiet for level or edge-less images', () => {
    expect(detectTilt(downsampleLuma(horizon(0)))).toBeNull();
    expect(detectTilt(downsampleLuma(makeImage(200, 150, () => [0.3, 0.3, 0.3])))).toBeNull();
  });
});
