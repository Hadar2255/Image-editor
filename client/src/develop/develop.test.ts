import { describe, expect, it } from 'vitest';
import { defaultEditParams, type Light } from '@raw/shared';
import { curveEvaluator } from './curves.ts';
import { buildToneLut, toneFunction } from './toneLut.ts';
import { LUMA, srgbDecode, srgbEncode, whiteBalanceGains } from './color.ts';

const light = (patch: Partial<Light> = {}): Light => ({ ...defaultEditParams().light, ...patch });
const isMonotonic = (lut: Float32Array) => lut.every((v, i) => i === 0 || v >= lut[i - 1] - 1e-6);

describe('curves', () => {
  it('identity curve returns its input', () => {
    const f = curveEvaluator([[0, 0], [1, 1]]);
    for (const x of [0, 0.1, 0.5, 0.93, 1]) expect(f(x)).toBeCloseTo(x, 6);
  });

  it('passes through its points and never overshoots', () => {
    const f = curveEvaluator([[0, 0], [0.25, 0.15], [0.75, 0.9], [1, 1]]);
    expect(f(0.25)).toBeCloseTo(0.15, 6);
    expect(f(0.75)).toBeCloseTo(0.9, 6);
    let prev = -1;
    for (let x = 0; x <= 1; x += 0.01) {
      const y = f(x);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
  });
});

describe('tone mapping', () => {
  it('is monotonic for extreme slider settings', () => {
    for (const patch of [
      {},
      { highlights: -100, shadows: 100 },
      { highlights: 100, shadows: -100 },
      { contrast: 100, whites: 100, blacks: -100 },
      { contrast: -100, whites: -100, blacks: 100 },
    ]) {
      expect(isMonotonic(buildToneLut(light(patch)))).toBe(true);
    }
  });

  it('keeps output in 0..1 and maps sensor clip near white', () => {
    const f = toneFunction(light());
    expect(f(0)).toBe(0);
    expect(f(1)).toBeCloseTo(1, 2);
    expect(f(16)).toBeLessThanOrEqual(1);
  });

  it('highlights and shadows move the right tones', () => {
    const base = toneFunction(light());
    const recover = toneFunction(light({ highlights: -100 }));
    const lift = toneFunction(light({ shadows: 100 }));
    expect(recover(0.8)).toBeLessThan(base(0.8));
    expect(recover(0.01)).toBeCloseTo(base(0.01), 3);
    expect(lift(0.01)).toBeGreaterThan(base(0.01) * 1.5);
    expect(lift(0.8)).toBeCloseTo(base(0.8), 2);
  });

  it('contrast pivots around middle grey', () => {
    const lo = toneFunction(light({ contrast: -60 }));
    const hi = toneFunction(light({ contrast: 60 }));
    expect(hi(0.18)).toBeCloseTo(lo(0.18), 6);
    expect(hi(0.02)).toBeLessThan(lo(0.02));
    expect(hi(0.6)).toBeGreaterThan(lo(0.6));
  });

  it('blacks lift or crush the floor', () => {
    expect(toneFunction(light({ blacks: 100 }))(0)).toBeGreaterThan(0.02);
    expect(toneFunction(light({ blacks: -100 }))(0.002)).toBe(0);
  });

  it('applies the luma curve in the display-encoded domain', () => {
    const f = toneFunction(light(), [[0, 0], [0.5, 0.7], [1, 1]]);
    const base = toneFunction(light());
    expect(srgbEncode(f(0.18))).toBeGreaterThan(srgbEncode(base(0.18)));
  });
});

describe('colour helpers', () => {
  it('sRGB encode/decode round-trip', () => {
    for (const v of [0, 0.001, 0.18, 0.5, 1]) expect(srgbDecode(srgbEncode(v))).toBeCloseTo(v, 6);
  });

  it('white balance is neutral at zero and preserves luminance', () => {
    expect(whiteBalanceGains(0, 0).map((g) => +g.toFixed(6))).toEqual([1, 1, 1]);
    for (const [t, g] of [[80, 0], [-80, 0], [0, 60], [40, -40]]) {
      const gains = whiteBalanceGains(t, g);
      expect(LUMA[0] * gains[0] + LUMA[1] * gains[1] + LUMA[2] * gains[2]).toBeCloseTo(1, 6);
    }
    const warm = whiteBalanceGains(50, 0);
    expect(warm[0]).toBeGreaterThan(warm[2]);
  });
});
