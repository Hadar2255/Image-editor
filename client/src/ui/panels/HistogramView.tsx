import { useEffect, useRef } from 'react';
import { useViewStore } from '../../state/viewStore.ts';

const W = 256;
const H = 90;

export function HistogramView() {
  const histogram = useViewStore((s) => s.histogram);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    if (!histogram) return;
    // Ignore the extreme bins when scaling so clipped pixels don't flatten the rest.
    let peak = 1;
    for (const ch of [histogram.r, histogram.g, histogram.b]) {
      for (let i = 1; i < 255; i++) peak = Math.max(peak, ch[i]);
    }
    ctx.globalCompositeOperation = 'lighter';
    const draw = (data: Uint32Array, color: string) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < 256; i++) ctx.lineTo(i, H - Math.min(1, Math.sqrt(data[i] / peak)) * H);
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    };
    draw(histogram.r, 'rgba(220, 60, 60, 0.75)');
    draw(histogram.g, 'rgba(60, 200, 80, 0.75)');
    draw(histogram.b, 'rgba(70, 110, 240, 0.75)');
    ctx.globalCompositeOperation = 'source-over';
  }, [histogram]);

  const clipped = (bins: Uint32Array[], idx: number) =>
    histogram ? Math.max(...bins.map((b) => b[idx])) / histogram.total > 0.002 : false;
  const shadowClip = histogram && clipped([histogram.r, histogram.g, histogram.b], 0);
  const highlightClip = histogram && clipped([histogram.r, histogram.g, histogram.b], 255);

  return (
    <div className="histogram">
      <canvas ref={canvas} width={W} height={H} />
      <span className={`clip-indicator left ${shadowClip ? 'on' : ''}`} title="Shadow clipping" />
      <span className={`clip-indicator right ${highlightClip ? 'on' : ''}`} title="Highlight clipping" />
    </div>
  );
}
