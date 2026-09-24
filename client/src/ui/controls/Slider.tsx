import { useEffect, useRef, type CSSProperties } from 'react';
import type { Range } from '@raw/shared';

export interface SliderProps {
  label: string;
  value: number;
  range: Range;
  /** Live updates while dragging. */
  onChange: (v: number) => void;
  /** Gesture finished (pointer released / key released): record one undo step. */
  onCommit: () => void;
  format?: (v: number) => string;
  /** CSS background for the track (e.g. a temperature gradient). */
  track?: string;
  testId?: string;
}

const defaultFormat = (v: number) => (Number.isInteger(v) ? `${v > 0 ? '+' : ''}${v}` : `${v > 0 ? '+' : ''}${v.toFixed(2)}`);

/**
 * Native range input (reliable on touch screens) with a centre-anchored fill,
 * and double-click / double-tap on the label to reset to the default.
 */
export function Slider({ label, value, range, onChange, onCommit, format = defaultFormat, track, testId }: SliderProps) {
  const input = useRef<HTMLInputElement>(null);
  const lastTap = useRef(0);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    // The native `change` event fires once, when the user lets go.
    const el = input.current!;
    const commit = () => commitRef.current();
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, []);

  const reset = () => {
    if (value === range.default) return;
    onChange(range.default);
    onCommit();
  };
  const onLabelPointerUp = () => {
    const now = performance.now();
    if (now - lastTap.current < 350) reset();
    lastTap.current = now;
  };

  const pct = (v: number) => ((v - range.min) / (range.max - range.min)) * 100;
  const anchor = pct(Math.min(range.max, Math.max(range.min, range.min < 0 ? 0 : range.min)));
  const pos = pct(value);
  const style = {
    '--fill-from': `${Math.min(anchor, pos)}%`,
    '--fill-to': `${Math.max(anchor, pos)}%`,
    ...(track && { '--track': track }),
  } as CSSProperties;

  return (
    <div className={`slider ${value !== range.default ? 'changed' : ''}`}>
      <div className="slider-head">
        <span className="slider-label" onPointerUp={onLabelPointerUp} title="Double-tap to reset">
          {label}
        </span>
        <span className="slider-value">{format(value)}</span>
      </div>
      <input
        ref={input}
        type="range"
        className={track ? 'custom-track' : undefined}
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        style={style}
        data-testid={testId}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={reset}
      />
    </div>
  );
}
