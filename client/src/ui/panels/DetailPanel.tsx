import { RANGES } from '@raw/shared';
import { Slider } from '../controls/Slider.tsx';
import { Section } from '../controls/Section.tsx';
import { useParamControl } from './useParamControl.ts';

export function DetailPanel({ photoId }: { photoId: string }) {
  const bind = useParamControl(photoId);
  const r = RANGES.detail;
  return (
    <Section title="Detail" defaultOpen={false}>
      <p className="hint">Zoom in (double-tap the photo) to judge sharpening and noise.</p>
      <h4 className="subhead">Sharpening</h4>
      <Slider label="Amount" range={r.sharpen} {...bind((p) => p.detail.sharpen, (d, v) => (d.detail.sharpen = v))} />
      <Slider label="Radius" range={r.sharpenRadius} format={(v) => v.toFixed(1)}
        {...bind((p) => p.detail.sharpenRadius, (d, v) => (d.detail.sharpenRadius = v))} />
      <Slider label="Detail" range={r.sharpenDetail} {...bind((p) => p.detail.sharpenDetail, (d, v) => (d.detail.sharpenDetail = v))} />
      <h4 className="subhead">Noise reduction</h4>
      <Slider label="Luminance" range={r.noiseLuma} {...bind((p) => p.detail.noiseLuma, (d, v) => (d.detail.noiseLuma = v))} />
      <Slider label="Color" range={r.noiseColor} {...bind((p) => p.detail.noiseColor, (d, v) => (d.detail.noiseColor = v))} />
    </Section>
  );
}
