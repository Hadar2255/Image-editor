import { useMemo, useRef, useState } from 'react';
import { IDENTITY_CURVE, type CurvePoint, type EditParams } from '@raw/shared';
import { Section } from '../controls/Section.tsx';
import { useEditStore, useParams } from '../../state/editStore.ts';
import { useViewStore } from '../../state/viewStore.ts';
import { curveEvaluator, isIdentityCurve } from '../../develop/curves.ts';

type Channel = keyof EditParams['curve'];
const CHANNELS: [Channel, string, string][] = [
  ['luma', 'RGB', '#e6e6e8'],
  ['red', 'R', '#ff6b6b'],
  ['green', 'G', '#5fd068'],
  ['blue', 'B', '#6b94ff'],
];
const HIT_RADIUS = 0.06;
const MIN_GAP = 0.02;

export function CurvePanel({ photoId }: { photoId: string }) {
  const params = useParams(photoId);
  const update = useEditStore((s) => s.update);
  const commit = useEditStore((s) => s.commit);
  const histogram = useViewStore((s) => s.histogram);
  const [channel, setChannel] = useState<Channel>('luma');
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ index: number; pointerId: number } | null>(null);
  const lastTap = useRef({ time: 0, index: -1 });

  const points = params.curve[channel];
  const color = CHANNELS.find((c) => c[0] === channel)![2];

  const path = useMemo(() => {
    const f = curveEvaluator(points);
    let d = '';
    for (let i = 0; i <= 100; i++) d += `${i === 0 ? 'M' : 'L'}${i} ${100 - f(i / 100) * 100} `;
    return d;
  }, [points]);

  const histPath = useMemo(() => {
    if (!histogram) return '';
    const data = channel === 'luma' ? histogram.l : histogram[channel[0] as 'r' | 'g' | 'b'];
    let peak = 1;
    for (let i = 1; i < 255; i++) peak = Math.max(peak, data[i]);
    let d = 'M0 100 ';
    for (let i = 0; i < 256; i++) d += `L${(i / 255) * 100} ${100 - Math.min(1, Math.sqrt(data[i] / peak)) * 100} `;
    return `${d}L100 100 Z`;
  }, [histogram, channel]);

  const setPoints = (next: CurvePoint[], transient: boolean) =>
    update(photoId, (d) => void (d.curve[channel] = next), { transient });

  const toCurve = (e: React.PointerEvent): CurvePoint => {
    const r = svg.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = 1 - (e.clientY - r.top) / r.height;
    return [x, y];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const [x, y] = toCurve(e);
    let index = points.findIndex((p) => Math.hypot(p[0] - x, p[1] - y) < HIT_RADIUS);
    const now = performance.now();
    if (index >= 0 && now - lastTap.current.time < 350 && lastTap.current.index === index) {
      // Double-tap removes a point (the two end points stay).
      if (index > 0 && index < points.length - 1) setPoints(points.filter((_, i) => i !== index), false);
      lastTap.current = { time: 0, index: -1 };
      return;
    }
    if (index < 0) {
      if (points.length >= 16) return;
      const y0 = curveEvaluator(points)(x);
      const next = [...points, [x, y0] as CurvePoint].sort((a, b) => a[0] - b[0]);
      index = next.findIndex((p) => p[0] === x);
      setPoints(next, true);
    }
    lastTap.current = { time: now, index };
    drag.current = { index, pointerId: e.pointerId };
    svg.current!.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const [x, y] = toCurve(e);
    // Read the live value: several pointer events can arrive between renders.
    const pts = useEditStore.getState().edits[photoId]?.params.curve[channel] ?? points;
    const lo = d.index > 0 ? pts[d.index - 1][0] + MIN_GAP : 0;
    const hi = d.index < pts.length - 1 ? pts[d.index + 1][0] - MIN_GAP : 1;
    const next = pts.map((p, i): CurvePoint => (i === d.index ? [Math.min(hi, Math.max(lo, x)), Math.min(1, Math.max(0, y))] : p));
    setPoints(next, true);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.pointerId !== e.pointerId) return;
    drag.current = null;
    commit(photoId);
  };

  const resetChannel = () => setPoints(IDENTITY_CURVE, false);

  return (
    <Section
      title="Tone curve"
      defaultOpen={false}
      actions={
        !isIdentityCurve(points) && (
          <button className="link-btn" onClick={resetChannel}>
            Reset
          </button>
        )
      }
    >
      <div className="tabs" role="tablist">
        {CHANNELS.map(([c, label, col]) => (
          <button key={c} role="tab" aria-selected={channel === c} className={channel === c ? 'tab active' : 'tab'}
            style={{ color: channel === c ? col : undefined }} onClick={() => setChannel(c)}>
            {label}
            {!isIdentityCurve(params.curve[c]) && <span className="dot" aria-hidden />}
          </button>
        ))}
      </div>
      <div className="curve-wrap">
      <svg
        ref={svg}
        className="curve-editor"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {histPath && <path d={histPath} className="curve-hist" />}
        {[25, 50, 75].map((v) => (
          <g key={v} className="curve-grid">
            <line x1={v} y1={0} x2={v} y2={100} />
            <line x1={0} y1={v} x2={100} y2={v} />
          </g>
        ))}
        <line x1={0} y1={100} x2={100} y2={0} className="curve-diagonal" />
        <path d={path} className="curve-line" style={{ stroke: color }} vectorEffect="non-scaling-stroke" />
      </svg>
      {/* Points drawn as HTML so they stay round in the stretched SVG. */}
      <div className="curve-points" aria-hidden>
        {points.map(([x, y], i) => (
          <span key={i} className="curve-point" style={{ left: `${x * 100}%`, top: `${(1 - y) * 100}%`, borderColor: color }} />
        ))}
      </div>
      </div>
      <p className="hint">Tap to add a point, drag to shape, double-tap a point to remove it.</p>
    </Section>
  );
}
