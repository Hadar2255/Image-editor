import type { CropRect } from '@raw/shared';

/** zoom = 1 fits the frame in the canvas; (cx, cy) is the view centre in frame-normalised coords. */
export interface ViewTransform {
  zoom: number;
  cx: number;
  cy: number;
}

export const FIT_VIEW: ViewTransform = { zoom: 1, cx: 0.5, cy: 0.5 };
export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };
export const MAX_ZOOM = 16;

/** Scale needed so a W×H image rotated by `angle` still covers a W×H frame. */
export function coverScale(angleRad: number, w: number, h: number): number {
  const a = Math.abs(angleRad);
  return Math.cos(a) + Math.max(w / h, h / w) * Math.sin(a);
}

export interface Layout {
  canvasW: number;
  canvasH: number;
  /** Size of the (straightened, cropped) frame in image pixels. */
  frameW: number;
  frameH: number;
  padding: number;
}

export function fitScale(l: Layout): number {
  const w = Math.max(1, l.canvasW - 2 * l.padding);
  const h = Math.max(1, l.canvasH - 2 * l.padding);
  return Math.min(w / l.frameW, h / l.frameH);
}

/** Canvas pixels per frame pixel. */
export function pixelScale(l: Layout, view: ViewTransform): number {
  return fitScale(l) * view.zoom;
}

/** Keep the view centred when the frame fits, otherwise keep the frame covering the canvas. */
export function clampView(l: Layout, view: ViewTransform): ViewTransform {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, view.zoom));
  const s = fitScale(l) * zoom;
  const clampAxis = (c: number, canvas: number, frame: number) => {
    const half = canvas / (2 * s * frame); // half the visible span, in frame units
    return half >= 0.5 ? 0.5 : Math.min(1 - half, Math.max(half, c));
  };
  return { zoom, cx: clampAxis(view.cx, l.canvasW, l.frameW), cy: clampAxis(view.cy, l.canvasH, l.frameH) };
}

/** Canvas point (device px) -> frame-normalised coords. */
export function canvasToFrame(l: Layout, view: ViewTransform, x: number, y: number): [number, number] {
  const s = pixelScale(l, view);
  return [view.cx + (x - l.canvasW / 2) / (s * l.frameW), view.cy + (y - l.canvasH / 2) / (s * l.frameH)];
}

/** Zoom to `zoom`, keeping the frame point under canvas point (x, y) fixed. */
export function zoomAt(l: Layout, view: ViewTransform, zoom: number, x: number, y: number): ViewTransform {
  const [fx, fy] = canvasToFrame(l, view, x, y);
  const next = { ...view, zoom: Math.min(MAX_ZOOM, Math.max(1, zoom)) };
  const s = pixelScale(l, next);
  next.cx = fx - (x - l.canvasW / 2) / (s * l.frameW);
  next.cy = fy - (y - l.canvasH / 2) / (s * l.frameH);
  return clampView(l, next);
}

export function panBy(l: Layout, view: ViewTransform, dx: number, dy: number): ViewTransform {
  const s = pixelScale(l, view);
  return clampView(l, { ...view, cx: view.cx - dx / (s * l.frameW), cy: view.cy - dy / (s * l.frameH) });
}
