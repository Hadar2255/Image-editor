import { describe, expect, it } from 'vitest';
import { defaultEditParams, parseEditParams, RANGES } from './params.ts';

describe('edit params', () => {
  it('fills every field with defaults', () => {
    const p = defaultEditParams();
    expect(p.light.exposure).toBe(0);
    expect(p.detail.noiseColor).toBe(25);
    expect(p.curve.luma).toEqual([[0, 0], [1, 1]]);
    expect(Object.keys(p.hsl)).toHaveLength(8);
    expect(p.geometry.crop).toBeNull();
  });

  it('clamps out-of-range values and replaces invalid ones', () => {
    const p = parseEditParams({ light: { exposure: 12, contrast: 'lots', shadows: -500 }, wb: { temp: NaN } });
    expect(p.light.exposure).toBe(5);
    expect(p.light.contrast).toBe(0);
    expect(p.light.shadows).toBe(-100);
    expect(p.wb.temp).toBe(0);
  });

  it('sorts curve points and rejects broken curves', () => {
    const p = parseEditParams({ curve: { luma: [[1, 1], [0, 0], [0.5, 0.7]], red: [[0.2, 0.2]] } });
    expect(p.curve.luma).toEqual([[0, 0], [0.5, 0.7], [1, 1]]);
    expect(p.curve.red).toEqual([[0, 0], [1, 1]]);
  });

  it('drops an invalid crop', () => {
    expect(parseEditParams({ geometry: { crop: { x: 0.5, y: 0, w: 0.9, h: 1 } } }).geometry.crop).toBeNull();
    const crop = { x: 0.1, y: 0.1, w: 0.8, h: 0.5 };
    expect(parseEditParams({ geometry: { crop } }).geometry.crop).toEqual(crop);
  });

  it('round-trips through JSON', () => {
    const p = parseEditParams({ light: { exposure: 0.7 }, hsl: { blue: { sat: -30 } } });
    expect(parseEditParams(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('exposes slider ranges derived from the schema', () => {
    expect(RANGES.light.exposure).toMatchObject({ min: -5, max: 5, default: 0 });
    expect(RANGES.detail.sharpenRadius).toMatchObject({ min: 0.5, max: 3, default: 1 });
    expect(RANGES.hsl.hue).toMatchObject({ min: -100, max: 100 });
  });
});
