import { RANGES, type CropRect } from '@raw/shared';
import { Slider } from '../controls/Slider.tsx';
import { Section } from '../controls/Section.tsx';
import { useParamControl } from './useParamControl.ts';
import { useEditStore, useParams } from '../../state/editStore.ts';
import { useAnalysis, useAnalysisStore } from '../../state/analysisStore.ts';

const ASPECTS: [string, number][] = [
  ['1:1', 1],
  ['4:5', 5 / 4],
  ['3:2', 3 / 2],
  ['16:9', 16 / 9],
];

/** Largest centred crop with the given long:short ratio, oriented like the image. */
export function centredCrop(imageW: number, imageH: number, ratio: number): CropRect {
  const target = imageW >= imageH ? ratio : 1 / ratio; // width / height in pixels
  const current = imageW / imageH;
  if (target < current) {
    const w = target / current;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = current / target;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
}

export function GeometryPanel({ photoId, imageSize }: { photoId: string; imageSize?: { width: number; height: number } }) {
  const bind = useParamControl(photoId);
  const params = useParams(photoId);
  const update = useEditStore((s) => s.update);
  const suggestion = useAnalysis(photoId)?.suggestion;
  const crop = params.geometry.crop;

  const applySuggestion = () => {
    if (!suggestion) return;
    update(photoId, (d) => {
      d.geometry.angle = suggestion.angle;
      if (suggestion.crop) d.geometry.crop = suggestion.crop;
    });
    useAnalysisStore.getState().set(photoId, { suggestion: undefined });
  };
  const describe = () => {
    const parts: string[] = [];
    if (suggestion?.angle) parts.push(`straighten ${suggestion.angle > 0 ? '+' : ''}${suggestion.angle.toFixed(1)}°`);
    if (suggestion?.crop) parts.push('crop');
    return parts.join(' and ');
  };

  return (
    <Section title="Straighten & crop" defaultOpen={false}>
      {suggestion && (suggestion.angle !== 0 || suggestion.crop) && (
        <div className="notice" data-testid="geometry-suggestion">
          <span>
            {suggestion.source === 'claude' ? 'Claude suggests' : 'Detected tilt — suggest'} {describe()}.
          </span>
          <div className="notice-actions">
            <button className="btn small primary" onClick={applySuggestion}>
              Apply
            </button>
            <button className="btn small" onClick={() => useAnalysisStore.getState().set(photoId, { suggestion: undefined })}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      <Slider label="Angle" range={RANGES.angle} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`}
        {...bind((p) => p.geometry.angle, (d, v) => (d.geometry.angle = v))} />
      <h4 className="subhead">Crop</h4>
      <div className="button-row wrap">
        <button className={`btn small ${crop ? '' : 'active'}`} onClick={() => update(photoId, (d) => void (d.geometry.crop = null))}>
          Original
        </button>
        {imageSize &&
          ASPECTS.map(([label, ratio]) => (
            <button key={label} className="btn small"
              onClick={() => update(photoId, (d) => void (d.geometry.crop = centredCrop(imageSize.width, imageSize.height, ratio)))}>
              {label}
            </button>
          ))}
      </div>
    </Section>
  );
}
