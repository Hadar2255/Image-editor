import { describe, expect, it } from 'vitest';
import { canvasToFrame, clampView, coverScale, FIT_VIEW, panBy, zoomAt, type Layout } from './viewMath.ts';

const layout: Layout = { canvasW: 1000, canvasH: 800, frameW: 3000, frameH: 2000, padding: 0 };

describe('view math', () => {
  it('cover scale is 1 without rotation and grows with the angle', () => {
    expect(coverScale(0, 3000, 2000)).toBe(1);
    expect(coverScale(0.1, 3000, 2000)).toBeGreaterThan(1);
    expect(coverScale(-0.1, 3000, 2000)).toBeCloseTo(coverScale(0.1, 3000, 2000));
  });

  it('keeps the point under the cursor fixed when zooming', () => {
    const before = canvasToFrame(layout, FIT_VIEW, 700, 300);
    const zoomed = zoomAt(layout, FIT_VIEW, 4, 700, 300);
    const after = canvasToFrame(layout, zoomed, 700, 300);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
  });

  it('never zooms out past fit and keeps the frame on screen', () => {
    expect(clampView(layout, { zoom: 0.3, cx: 0.9, cy: 0.1 })).toEqual(FIT_VIEW);
    const panned = panBy(layout, { zoom: 3, cx: 0.5, cy: 0.5 }, 100000, 100000);
    const s = (1000 / 3000) * 3; // canvas px per frame px
    expect(panned.cx).toBeCloseTo(1000 / (2 * s * 3000), 6);
  });
});
