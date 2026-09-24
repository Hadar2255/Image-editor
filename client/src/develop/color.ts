/** sRGB transfer functions (display-linear <-> encoded). */
export function srgbEncode(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function srgbDecode(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export const LUMA = [0.2126, 0.7152, 0.0722] as const;

/**
 * White balance as per-channel gains relative to the camera's as-shot WB.
 * Temperature moves along blue↔amber, tint along green↔magenta; gains are
 * normalised so overall brightness stays put.
 */
export function whiteBalanceGains(temp: number, tint: number): [number, number, number] {
  const t = temp / 100;
  const g = tint / 100;
  const r = Math.pow(2, t * 0.6 + g * 0.15);
  const gr = Math.pow(2, -g * 0.45);
  const b = Math.pow(2, -t * 0.8 + g * 0.15);
  const lum = LUMA[0] * r + LUMA[1] * gr + LUMA[2] * b;
  return [r / lum, gr / lum, b / lum];
}
