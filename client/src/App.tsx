import { useCallback, useState } from 'react';
import { usePhotoStore, useActivePhoto } from './state/photoStore.ts';
import { isRawFile } from './raw/rawLoader.ts';
import { loadThumbnails } from './raw/decodeQueue.ts';
import { DropZone, FilePickerButton } from './ui/DropZone.tsx';
import { Viewer } from './ui/Viewer.tsx';
import { Filmstrip } from './ui/Filmstrip.tsx';
import { EditPanel } from './ui/EditPanel.tsx';
import { Toolbar } from './ui/Toolbar.tsx';

export default function App() {
  const add = usePhotoStore((s) => s.add);
  const hasPhotos = usePhotoStore((s) => s.photos.length > 0);
  const active = useActivePhoto();
  const [skipped, setSkipped] = useState<string[]>([]);

  const onFiles = useCallback(
    (files: File[]) => {
      const raws = files.filter((f) => isRawFile(f.name));
      setSkipped(files.filter((f) => !isRawFile(f.name)).map((f) => f.name));
      if (raws.length === 0) return;
      loadThumbnails(add(raws).map((p) => p.id));
    },
    [add],
  );

  return (
    <DropZone onFiles={onFiles}>
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden>◐</span> RAW Studio
          </div>
          {hasPhotos && <Toolbar photoId={active?.id ?? null} />}
          <div className="topbar-actions">
            <FilePickerButton onFiles={onFiles}>Open RAW…</FilePickerButton>
          </div>
        </header>

        {!crossOriginIsolated && (
          <div className="banner error">
            The page is not cross-origin isolated, so the RAW decoder cannot start. Serve it through
            <code> npm run dev </code> or <code> npm start </code> (they send the COOP/COEP headers).
          </div>
        )}

        {skipped.length > 0 && (
          <div className="banner warn" role="status">
            Skipped {skipped.length} non-RAW file{skipped.length > 1 ? 's' : ''}: {skipped.slice(0, 3).join(', ')}
            {skipped.length > 3 && '…'}
            <button className="banner-close" onClick={() => setSkipped([])} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        <main className="workspace">
          <section className="viewer-area">
            {hasPhotos ? <Viewer photo={active} /> : <EmptyState onFiles={onFiles} />}
          </section>
          <aside className="side-panel">{active && <EditPanel photo={active} />}</aside>
        </main>

        {hasPhotos && <Filmstrip />}
      </div>
    </DropZone>
  );
}

function EmptyState({ onFiles }: { onFiles: (files: File[]) => void }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden>⬇</div>
      <h1>Drop RAW files here</h1>
      <p>ARW, CR3, NEF, DNG and more. Files are decoded locally in your browser — nothing is uploaded.</p>
      <FilePickerButton onFiles={onFiles} primary>
        Choose files
      </FilePickerButton>
    </div>
  );
}
