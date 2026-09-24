import { usePhotoStore } from '../state/photoStore.ts';
import { forgetPreview } from '../raw/decodeQueue.ts';
import { useEditStore } from '../state/editStore.ts';
import { useAnalysisStore } from '../state/analysisStore.ts';

export function Filmstrip() {
  const photos = usePhotoStore((s) => s.photos);
  const activeId = usePhotoStore((s) => s.activeId);
  const setActive = usePhotoStore((s) => s.setActive);
  const remove = usePhotoStore((s) => s.remove);

  return (
    <nav className="filmstrip" aria-label="Photos">
      {photos.map((p) => (
        <div key={p.id} className={`film-item ${p.id === activeId ? 'active' : ''}`}>
          <button className="film-thumb" onClick={() => setActive(p.id)} title={p.name}>
            {p.thumbUrl ? <img src={p.thumbUrl} alt={p.name} /> : <span className="film-placeholder">{p.status === 'error' ? '!' : '…'}</span>}
          </button>
          <button
            className="film-remove"
            aria-label={`Remove ${p.name}`}
            onClick={() => {
              forgetPreview(p.id);
              remove(p.id);
              useEditStore.getState().remove(p.id);
              useAnalysisStore.getState().remove(p.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </nav>
  );
}
