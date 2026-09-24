import { RANGES } from '@raw/shared';
import { Slider } from '../controls/Slider.tsx';
import { Section } from '../controls/Section.tsx';
import { useParamControl } from './useParamControl.ts';

export function GeometryPanel({ photoId }: { photoId: string }) {
  const bind = useParamControl(photoId);
  return (
    <Section title="Straighten" defaultOpen={false}>
      <Slider label="Angle" range={RANGES.angle} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`}
        {...bind((p) => p.geometry.angle, (d, v) => (d.geometry.angle = v))} />
    </Section>
  );
}
