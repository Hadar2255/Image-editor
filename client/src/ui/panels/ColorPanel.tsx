import { useState } from 'react';
import { HSL_BANDS, RANGES, type HslBand } from '@raw/shared';
import { Slider } from '../controls/Slider.tsx';
import { Section } from '../controls/Section.tsx';
import { useParamControl } from './useParamControl.ts';
import { useEditStore } from '../../state/editStore.ts';

const BAND_COLOR: Record<HslBand, string> = {
  red: '#e0443e', orange: '#ec8a2f', yellow: '#e6cf3a', green: '#4cb050',
  aqua: '#3bc0c4', blue: '#3f6fe0', purple: '#8a4fd8', magenta: '#d44bb5',
};
const BAND_LABEL: Record<HslBand, string> = {
  red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green',
  aqua: 'Aqua', blue: 'Blue', purple: 'Purple', magenta: 'Magenta',
};

function trackFor(mode: 'hue' | 'sat' | 'lum', band: HslBand): string {
  const i = HSL_BANDS.indexOf(band);
  const c = BAND_COLOR[band];
  if (mode === 'hue') {
    const prev = BAND_COLOR[HSL_BANDS[(i + 7) % 8]];
    const next = BAND_COLOR[HSL_BANDS[(i + 1) % 8]];
    return `linear-gradient(90deg, ${prev}, ${c} 50%, ${next})`;
  }
  if (mode === 'sat') return `linear-gradient(90deg, #8a8a8a, ${c})`;
  return `linear-gradient(90deg, #111, ${c} 50%, #f4f4f4)`;
}

type Mode = 'hue' | 'sat' | 'lum';
const MODES: [Mode, string][] = [['hue', 'Hue'], ['sat', 'Saturation'], ['lum', 'Luminance']];

export function ColorPanel({ photoId }: { photoId: string }) {
  const bind = useParamControl(photoId);
  const update = useEditStore((s) => s.update);
  const [mode, setMode] = useState<Mode>('sat');
  const r = RANGES.color;
  const resetHsl = () =>
    update(photoId, (d) => {
      for (const b of HSL_BANDS) d.hsl[b][mode] = 0;
    });

  return (
    <>
      <Section title="Color">
        <Slider label="Vibrance" range={r.vibrance} {...bind((p) => p.color.vibrance, (d, v) => (d.color.vibrance = v))} />
        <Slider label="Saturation" range={r.saturation} {...bind((p) => p.color.saturation, (d, v) => (d.color.saturation = v))} />
      </Section>
      <Section title="HSL" defaultOpen={false} actions={<button className="link-btn" onClick={resetHsl}>Reset</button>}>
        <div className="tabs" role="tablist">
          {MODES.map(([m, label]) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'tab active' : 'tab'} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>
        {HSL_BANDS.map((band) => (
          <Slider key={`${mode}-${band}`} label={BAND_LABEL[band]} range={RANGES.hsl[mode]} track={trackFor(mode, band)}
            {...bind((p) => p.hsl[band][mode], (d, v) => (d.hsl[band][mode] = v))} />
        ))}
      </Section>
    </>
  );
}
