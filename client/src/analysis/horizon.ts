import type { LumaPlane } from './stats.ts';

const RANGE_DEG = 6;
const STEP_DEG = 0.1;

/**
 * Detects a small tilt from the dominant near-horizontal / near-vertical
 * edges (horizons, buildings) with a Hough-style search: for each candidate
 * angle, edge pixels are projected onto the line normal and the angle where
 * they pile up most sharply wins. Returns the straighten angle to apply
 * (+ = rotate clockwise), or null when there's no confident answer.
 */
export function detectTilt(plane: LumaPlane): number | null {
  const { width: w, height: h, data } = plane;
  if (w < 16 || h < 16) return null;
  // Perceptual (gamma) values so dark and bright edges count similarly.
  const v = (x: number, y: number) => Math.sqrt(data[y * w + x]);

  const hx: number[] = [], hy: number[] = [], hm: number[] = []; // near-horizontal edges
  const vx: number[] = [], vy: number[] = [], vm: number[] = []; // near-vertical edges
  const all: number[] = [];
  const grads: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx = v(x + 1, y - 1) + 2 * v(x + 1, y) + v(x + 1, y + 1) - v(x - 1, y - 1) - 2 * v(x - 1, y) - v(x - 1, y + 1);
      const gy = v(x - 1, y + 1) + 2 * v(x, y + 1) + v(x + 1, y + 1) - v(x - 1, y - 1) - 2 * v(x, y - 1) - v(x + 1, y - 1);
      const m = Math.hypot(gx, gy);
      all.push(m);
      grads.push(x, y, gx, gy, m);
    }
  }
  const sorted = Float32Array.from(all).sort();
  const threshold = Math.max(sorted[Math.floor(sorted.length * 0.9)], sorted[sorted.length - 1] * 0.2, 0.05);
  for (let i = 0; i < grads.length; i += 5) {
    const [x, y, gx, gy, m] = [grads[i], grads[i + 1], grads[i + 2], grads[i + 3], grads[i + 4]];
    if (m < threshold) continue;
    if (Math.abs(gy) > 2 * Math.abs(gx)) { hx.push(x); hy.push(y); hm.push(m); }
    else if (Math.abs(gx) > 2 * Math.abs(gy)) { vx.push(x); vy.push(y); vm.push(m); }
  }
  if (hm.length + vm.length < 30) return null;

  const span = w + h;
  const bins = new Float64Array(span * 2 + 2);
  /** Peakiness of the projection: sum of squared bin weights. */
  const score = (xs: number[], ys: number[], ms: number[], t: number, vertical: boolean) => {
    bins.fill(0);
    for (let i = 0; i < ms.length; i++) {
      // Content rotated by θ: horizontals follow y = x·tanθ + c, verticals x = -y·tanθ + c.
      const c = vertical ? xs[i] + ys[i] * t : ys[i] - xs[i] * t;
      bins[Math.round(c) + span] += ms[i];
    }
    let s = 0;
    for (let i = 0; i < bins.length; i++) s += bins[i] * bins[i];
    return s;
  };

  const scores: number[] = [];
  let best = 0;
  const steps = Math.round((2 * RANGE_DEG) / STEP_DEG);
  for (let k = 0; k <= steps; k++) {
    const deg = -RANGE_DEG + k * STEP_DEG;
    const t = Math.tan((deg * Math.PI) / 180);
    const s = score(hx, hy, hm, t, false) + score(vx, vy, vm, t, true);
    scores.push(s);
    if (s > scores[best]) best = k;
  }
  const median = [...scores].sort((a, b) => a - b)[Math.floor(scores.length / 2)];
  const tilt = -RANGE_DEG + best * STEP_DEG;
  const confident = scores[best] > 1.5 * median;
  if (!confident || Math.abs(tilt) < 0.4 || Math.abs(tilt) > RANGE_DEG - 0.5) return null;
  return Math.round(-tilt * 10) / 10;
}
