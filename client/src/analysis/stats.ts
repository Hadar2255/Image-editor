import type { LinearImage } from '../raw/rawLoader.ts';
import { LUMA } from '../develop/color.ts';

/** Scene-linear statistics of a decoded RAW (luminance 0..1, 1 = sensor clip). */
export interface ImageStats {
  width: number;
  height: number;
  /** Luminance percentiles. */
  p: { p001: number; p01: number; p05: number; p25: number; p50: number; p75: number; p95: number; p99: number; p995: number; p999: number };
  /** Geometric mean luminance (the scene "key"). */
  geoMean: number;
  /** Fraction of pixels with a clipped channel. */
  clipped: number;
  /** Mean RGB of near-neutral mid-tone pixels (for white balance), or null when there are too few. */
  neutral: [number, number, number] | null;
  neutralFraction: number;
}

/** Downsampled luminance plane (for edge analysis). */
export interface LumaPlane {
  width: number;
  height: number;
  data: Float32Array;
}

const MAX_SAMPLE_SIDE = 480;

export function downsampleLuma(img: LinearImage, maxSide = MAX_SAMPLE_SIDE): LumaPlane {
  const step = Math.max(1, Math.ceil(Math.max(img.width, img.height) / maxSide));
  const w = Math.floor(img.width / step);
  const h = Math.floor(img.height / step);
  const data = new Float32Array(w * h);
  const src = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Box-average the step×step block for a clean downsample.
      let sum = 0;
      let n = 0;
      for (let dy = 0; dy < step; dy += Math.max(1, step >> 1)) {
        for (let dx = 0; dx < step; dx += Math.max(1, step >> 1)) {
          const i = ((y * step + dy) * img.width + (x * step + dx)) * 3;
          sum += LUMA[0] * src[i] + LUMA[1] * src[i + 1] + LUMA[2] * src[i + 2];
          n++;
        }
      }
      data[y * w + x] = sum / n / 65535;
    }
  }
  return { width: w, height: h, data };
}

export function computeStats(img: LinearImage, maxSide = MAX_SAMPLE_SIDE): ImageStats {
  const step = Math.max(1, Math.ceil(Math.max(img.width, img.height) / maxSide));
  const src = img.data;
  const lum: number[] = [];
  let logSum = 0;
  let clipped = 0;
  let nr = 0, ng = 0, nb = 0, nCount = 0;
  const clipLevel = 0.985 * 65535;

  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const i = (y * img.width + x) * 3;
      const r = src[i], g = src[i + 1], b = src[i + 2];
      const l = (LUMA[0] * r + LUMA[1] * g + LUMA[2] * b) / 65535;
      lum.push(l);
      logSum += Math.log2(Math.max(l, 1e-5));
      if (r >= clipLevel || g >= clipLevel || b >= clipLevel) clipped++;
      // Near-neutral mid-tones are the best evidence of the light's colour.
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (l > 0.02 && l < 0.7 && mn > 0 && mx / mn < 1.6) {
        nr += r; ng += g; nb += b; nCount++;
      }
    }
  }
  const sorted = Float32Array.from(lum).sort();
  const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  const n = sorted.length;
  return {
    width: img.width,
    height: img.height,
    p: {
      p001: pct(0.001), p01: pct(0.01), p05: pct(0.05), p25: pct(0.25), p50: pct(0.5),
      p75: pct(0.75), p95: pct(0.95), p99: pct(0.99), p995: pct(0.995), p999: pct(0.999),
    },
    geoMean: Math.pow(2, logSum / n),
    clipped: clipped / n,
    neutral: nCount / n > 0.02 ? [nr / nCount, ng / nCount, nb / nCount] : null,
    neutralFraction: nCount / n,
  };
}
