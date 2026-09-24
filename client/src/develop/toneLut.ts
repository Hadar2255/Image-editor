import type { CurvePoint, Light } from '@raw/shared';
import { curveEvaluator } from './curves.ts';
import { srgbDecode, srgbEncode } from './color.ts';

/**
 * Global tone mapping, baked into a 1D lookup table.
 *
 * Input: scene luminance after exposure (linear, 1.0 = sensor clip), indexed
 * in log2 space so shadows get as much resolution as highlights.
 * Output: display-linear luminance in 0..1.
 *
 * The shader scales each pixel's RGB by output/input luminance, which keeps
 * hues stable while all of highlights/shadows/whites/blacks/contrast and the
 * luma tone curve are applied in one texture fetch.
 */
export const TONE_LUT_SIZE = 2048;
export const TONE_LUT_LOG_MIN = -18;
export const TONE_LUT_LOG_MAX = 6;

const MID_GREY = 0.18;

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Scene luminance -> display-linear luminance for the given light settings. */
export function toneFunction(light: Light, lumaCurve?: CurvePoint[]): (sceneLum: number) => number {
  const curve = lumaCurve ? curveEvaluator(lumaCurve) : null;
  const hl = light.highlights / 100;
  const sh = light.shadows / 100;
  const contrast = 1 + (light.contrast / 100) * 0.55;
  // Whites move the scene value that maps to display white; blacks move the floor.
  const white = Math.pow(2, -(light.whites / 100) * 1.3);
  const black = -(light.blacks / 100) * 0.035;

  return (L: number) => {
    let d = 0;
    if (L > 0) {
      // Work in stops relative to middle grey.
      let e = Math.log2(L / MID_GREY);
      e += hl * 1.6 * smoothstep(-0.5, 3.0, e);
      e += sh * 1.6 * (1 - smoothstep(-5.0, -0.5, e));
      e *= contrast;
      const x = MID_GREY * Math.pow(2, e);
      // Extended Reinhard shoulder: rolls highlights off smoothly into `white`.
      d = Math.min(1, (x * (1 + x / (white * white))) / (1 + x));
    }
    d = (d - black) / (1 - black);
    d = Math.min(1, Math.max(0, d));
    if (curve) d = srgbDecode(curve(srgbEncode(d)));
    return d;
  };
}

export function buildToneLut(light: Light, lumaCurve?: CurvePoint[]): Float32Array {
  const f = toneFunction(light, lumaCurve);
  const lut = new Float32Array(TONE_LUT_SIZE);
  for (let i = 0; i < TONE_LUT_SIZE; i++) {
    const logL = TONE_LUT_LOG_MIN + (i / (TONE_LUT_SIZE - 1)) * (TONE_LUT_LOG_MAX - TONE_LUT_LOG_MIN);
    lut[i] = f(Math.pow(2, logL));
  }
  return lut;
}

/** Per-channel curves in the display-encoded domain, packed as RGBA rows of `size`. */
export function buildRgbCurveLut(red: CurvePoint[], green: CurvePoint[], blue: CurvePoint[], size = 256): Float32Array {
  const fs = [curveEvaluator(red), curveEvaluator(green), curveEvaluator(blue)];
  const lut = new Float32Array(size * 4);
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1);
    lut[i * 4] = fs[0](x);
    lut[i * 4 + 1] = fs[1](x);
    lut[i * 4 + 2] = fs[2](x);
    lut[i * 4 + 3] = 1;
  }
  return lut;
}
