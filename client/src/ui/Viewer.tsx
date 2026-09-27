import { useEffect, useRef, useState } from 'react';
import type { Photo } from '../state/photoStore.ts';
import { loadPreview } from '../raw/decodeQueue.ts';
import { Renderer } from '../gl/Renderer.ts';
import { FIT_VIEW, fitScale, panBy, pixelScale, zoomAt, clampView } from '../gl/viewMath.ts';
import { useParams } from '../state/editStore.ts';
import { useViewStore } from '../state/viewStore.ts';
import { setActiveRenderer } from '../gl/activeRenderer.ts';
import { runAutoEdit } from '../auto/autoEdit.ts';

const HISTOGRAM_INTERVAL_MS = 120;
const DOUBLE_TAP_MS = 300;
const DIVIDER_HIT_CSS = 18;

export function Viewer({ photo }: { photo: Photo | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const params = useParams(photo?.id ?? null);
  const { view, split, showBefore } = useViewStore();

  // ---- renderer lifecycle
  useEffect(() => {
    const canvas = canvasRef.current!;
    let renderer: Renderer;
    try {
      renderer = new Renderer(canvas);
    } catch (e) {
      setGlError(e instanceof Error ? e.message : String(e));
      return;
    }
    rendererRef.current = renderer;

    let histTimer = 0;
    let lastHist = 0;
    const refreshHistogram = () => {
      lastHist = performance.now();
      useViewStore.getState().setHistogram(renderer.readHistogram());
    };
    renderer.onDeveloped = () => {
      clearTimeout(histTimer);
      const wait = HISTOGRAM_INTERVAL_MS - (performance.now() - lastHist);
      if (wait <= 0) refreshHistogram();
      else histTimer = window.setTimeout(refreshHistogram, wait);
    };

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      renderer.resize(width, height);
      const { view, setView } = useViewStore.getState();
      const layout = renderer.layout();
      if (layout) setView(clampView(layout, view));
    });
    ro.observe(canvas);
    return () => {
      clearTimeout(histTimer);
      ro.disconnect();
      setActiveRenderer(null);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  // ---- load the active photo
  const photoId = photo?.id;
  useEffect(() => {
    if (!photoId) return;
    let cancelled = false;
    setShownId(null);
    if (rendererRef.current) setActiveRenderer(rendererRef.current, null);
    useViewStore.getState().setView(FIT_VIEW);
    useViewStore.getState().setHistogram(null);
    loadPreview(photoId)
      .then((img) => {
        if (cancelled || !rendererRef.current) return;
        try {
          const renderer = rendererRef.current;
          renderer.setImage(img);
          setActiveRenderer(renderer, photoId);
          setShownId(photoId);
          void runAutoEdit(photoId, img, renderer);
        } catch (e) {
          setGlError(e instanceof Error ? e.message : String(e));
        }
      })
      .catch(() => {
        /* decode errors are reflected in the photo store */
      });
    return () => {
      cancelled = true;
    };
  }, [photoId]);

  // ---- push state into the renderer
  useEffect(() => {
    rendererRef.current?.setParams(params);
  }, [params, shownId]);

  useEffect(() => {
    rendererRef.current?.setDisplay({ view, split, showBefore });
  }, [view, split, showBefore]);

  // Zoom readout relative to the full-resolution file (the preview is half size).
  useEffect(() => {
    const r = rendererRef.current;
    const layout = r?.layout();
    const img = r?.imageSize;
    if (!r || !layout || !img || !photo?.meta || shownId !== photoId) {
      useViewStore.getState().setZoomPercent(null);
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const perSensorPixel = (pixelScale(layout, view) * img.width) / photo.meta.width / dpr;
    useViewStore.getState().setZoomPercent(perSensorPixel);
  }, [view, shownId, photoId, photo?.meta, params.geometry.crop]);

  // ---- gestures: pan, pinch, wheel zoom, double-tap zoom, divider drag
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'pan' | 'pinch' | 'divider'; dist?: number } | null>(null);
  const lastTap = useRef({ time: 0, x: 0, y: 0 });

  const devicePoint = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const layout = rendererRef.current?.layout();
    if (!layout) return;
    canvasRef.current!.setPointerCapture(e.pointerId);
    const p = devicePoint(e);
    pointers.current.set(e.pointerId, p);
    const dpr = window.devicePixelRatio || 1;
    const { split } = useViewStore.getState();

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    if (split !== null && Math.abs(p.x - split * layout.canvasW) < DIVIDER_HIT_CSS * dpr) {
      gesture.current = { kind: 'divider' };
      return;
    }
    gesture.current = { kind: 'pan' };

    const now = performance.now();
    const t = lastTap.current;
    if (now - t.time < DOUBLE_TAP_MS && Math.hypot(p.x - t.x, p.y - t.y) < 30 * dpr) {
      // Double tap / double click: toggle fit <-> 100% of the preview pixels.
      const { view, setView } = useViewStore.getState();
      const oneToOne = Math.max(1.5, 1 / fitScale(layout));
      setView(view.zoom > 1.01 ? FIT_VIEW : zoomAt(layout, view, oneToOne, p.x, p.y));
      lastTap.current = { time: 0, x: 0, y: 0 };
      return;
    }
    lastTap.current = { time: now, x: p.x, y: p.y };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const prev = pointers.current.get(e.pointerId);
    const layout = rendererRef.current?.layout();
    if (!prev || !layout || !gesture.current) return;
    const p = devicePoint(e);
    pointers.current.set(e.pointerId, p);
    const store = useViewStore.getState();

    if (gesture.current.kind === 'divider') {
      store.setSplit(Math.min(0.98, Math.max(0.02, p.x / layout.canvasW)));
    } else if (gesture.current.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ratio = dist / (gesture.current.dist || dist);
      gesture.current.dist = dist;
      store.setView(zoomAt(layout, store.view, store.view.zoom * ratio, mid.x, mid.y));
    } else if (gesture.current.kind === 'pan' && store.view.zoom > 1) {
      store.setView(panBy(layout, store.view, p.x - prev.x, p.y - prev.y));
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) gesture.current = null;
    else if (pointers.current.size === 1) gesture.current = { kind: 'pan' };
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      const layout = rendererRef.current?.layout();
      if (!layout) return;
      e.preventDefault();
      const p = devicePoint(e);
      const store = useViewStore.getState();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      store.setView(zoomAt(layout, store.view, store.view.zoom * factor, p.x, p.y));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const decoded = shownId === photoId;
  return (
    <div className="viewer">
      <canvas
        ref={canvasRef}
        className="viewer-canvas"
        style={{ opacity: decoded ? 1 : 0, cursor: view.zoom > 1 ? 'grab' : 'zoom-in' }}
        data-testid="viewer-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {!decoded && photo?.thumbUrl && <img className="viewer-placeholder" src={photo.thumbUrl} alt="" />}
      {decoded && split !== null && (
        <>
          <span className="split-label left">Before</span>
          <span className="split-label right">After</span>
        </>
      )}
      {decoded && showBefore && <span className="split-label left">Before</span>}
      {!decoded && photo?.status !== 'error' && (
        <div className="viewer-status">
          <span className="spinner" /> {photo?.status === 'decoding' ? 'Developing RAW…' : 'Reading file…'}
        </div>
      )}
      {photo?.status === 'error' && <div className="viewer-status error">Could not decode: {photo.error}</div>}
      {glError && <div className="viewer-status error">{glError}</div>}
    </div>
  );
}
