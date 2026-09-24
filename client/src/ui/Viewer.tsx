import { useEffect, useRef, useState } from 'react';
import type { Photo } from '../state/photoStore.ts';
import { loadPreview } from '../raw/decodeQueue.ts';
import { Renderer } from '../gl/Renderer.ts';

export function Viewer({ photo }: { photo: Photo | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const [glError, setGlError] = useState<string | null>(null);

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
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      renderer.resize(width, height);
    });
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  const photoId = photo?.id;
  useEffect(() => {
    if (!photoId) return;
    let cancelled = false;
    setShownId(null);
    loadPreview(photoId)
      .then((img) => {
        if (cancelled || !rendererRef.current) return;
        try {
          rendererRef.current.setImage(img);
          setShownId(photoId);
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

  const decoded = shownId === photoId;
  return (
    <div className="viewer">
      <canvas ref={canvasRef} className="viewer-canvas" style={{ opacity: decoded ? 1 : 0 }} data-testid="viewer-canvas" />
      {!decoded && photo?.thumbUrl && <img className="viewer-placeholder" src={photo.thumbUrl} alt="" />}
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
