import { RANGES } from '@raw/shared';
import { Slider } from '../controls/Slider.tsx';
import { Section } from '../controls/Section.tsx';
import { useParamControl } from './useParamControl.ts';

const TEMP_TRACK = 'linear-gradient(90deg, #3d7fd9, #c9c9c9 50%, #e2b13c)';
const TINT_TRACK = 'linear-gradient(90deg, #3fae4c, #c9c9c9 50%, #c64fc0)';

export function WhiteBalancePanel({ photoId }: { photoId: string }) {
  const bind = useParamControl(photoId);
  return (
    <Section title="White balance">
      <Slider label="Temperature" range={RANGES.wb.temp} track={TEMP_TRACK}
        {...bind((p) => p.wb.temp, (d, v) => (d.wb.temp = v))} />
      <Slider label="Tint" range={RANGES.wb.tint} track={TINT_TRACK}
        {...bind((p) => p.wb.tint, (d, v) => (d.wb.tint = v))} />
    </Section>
  );
}

export function LightPanel({ photoId }: { photoId: string }) {
  const bind = useParamControl(photoId);
  const r = RANGES.light;
  return (
    <Section title="Light">
      <Slider label="Exposure" range={r.exposure} testId="slider-exposure"
        format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV`}
        {...bind((p) => p.light.exposure, (d, v) => (d.light.exposure = v))} />
      <Slider label="Contrast" range={r.contrast} {...bind((p) => p.light.contrast, (d, v) => (d.light.contrast = v))} />
      <Slider label="Highlights" range={r.highlights} {...bind((p) => p.light.highlights, (d, v) => (d.light.highlights = v))} />
      <Slider label="Shadows" range={r.shadows} {...bind((p) => p.light.shadows, (d, v) => (d.light.shadows = v))} />
      <Slider label="Whites" range={r.whites} {...bind((p) => p.light.whites, (d, v) => (d.light.whites = v))} />
      <Slider label="Blacks" range={r.blacks} {...bind((p) => p.light.blacks, (d, v) => (d.light.blacks = v))} />
    </Section>
  );
}
