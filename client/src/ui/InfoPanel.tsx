import type { Photo } from '../state/photoStore.ts';

const formatShutter = (s: number) => (s >= 1 || s <= 0 ? `${s}s` : `1/${Math.round(1 / s)}s`);
const formatMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function InfoPanel({ photo }: { photo: Photo }) {
  const m = photo.meta;
  const rows: [string, string | undefined][] = [
    ['File', photo.name],
    ['Size', formatMB(photo.size)],
    ['Camera', m && `${m.make} ${m.model}`.trim()],
    ['Lens', m?.lens || undefined],
    ['Exposure', m && `${formatShutter(m.shutter)} · f/${m.aperture.toFixed(1)} · ISO ${m.iso}`],
    ['Focal length', m && `${Math.round(m.focalLength)} mm`],
    ['Captured', m?.timestamp ? new Date(m.timestamp).toLocaleString() : undefined],
    ['Sensor', m && `${m.width} × ${m.height}`],
    ['Edit preview', photo.previewSize && `${photo.previewSize.width} × ${photo.previewSize.height}`],
    ['Decode time', photo.decodeMs !== undefined ? `${(photo.decodeMs / 1000).toFixed(2)} s` : undefined],
  ];
  return (
    <div className="panel">
      <h2 className="panel-title">Info</h2>
      <dl className="info-list">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="info-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
