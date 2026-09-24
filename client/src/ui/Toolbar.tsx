import { useEffect } from 'react';
import { useEditStore, useHistoryState } from '../state/editStore.ts';
import { useViewStore } from '../state/viewStore.ts';

export function Toolbar({ photoId }: { photoId: string | null }) {
  const { canUndo, canRedo, isEdited } = useHistoryState(photoId);
  const { undo, redo, reset } = useEditStore();
  const split = useViewStore((s) => s.split);
  const toggleSplit = useViewStore((s) => s.toggleSplit);
  const setShowBefore = useViewStore((s) => s.setShowBefore);
  const zoomPercent = useViewStore((s) => s.zoomPercent);

  useEffect(() => {
    if (!photoId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(photoId);
        else undo(photoId);
      } else if (mod && key === 'y') {
        e.preventDefault();
        redo(photoId);
      } else if (e.key === '\\' && !mod) {
        e.preventDefault();
        toggleSplit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photoId, undo, redo, toggleSplit]);

  const disabled = !photoId;
  return (
    <div className="toolbar" role="toolbar">
      <button className="icon-btn" disabled={disabled || !canUndo} onClick={() => photoId && undo(photoId)} title="Undo (Ctrl/⌘+Z)">
        ↶<span className="btn-text">Undo</span>
      </button>
      <button className="icon-btn" disabled={disabled || !canRedo} onClick={() => photoId && redo(photoId)} title="Redo (Ctrl/⌘+Shift+Z)">
        ↷<span className="btn-text">Redo</span>
      </button>
      <span className="toolbar-sep" />
      <button className={`icon-btn ${split !== null ? 'active' : ''}`} disabled={disabled} onClick={toggleSplit} title="Before / after split (\)" data-testid="split-toggle">
        ◧<span className="btn-text">Compare</span>
      </button>
      <button
        className="icon-btn"
        disabled={disabled}
        title="Hold to see the original"
        onPointerDown={() => setShowBefore(true)}
        onPointerUp={() => setShowBefore(false)}
        onPointerLeave={() => setShowBefore(false)}
        onPointerCancel={() => setShowBefore(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        ◐<span className="btn-text">Hold</span>
      </button>
      <span className="toolbar-sep" />
      <button className="icon-btn" disabled={disabled || !isEdited} onClick={() => photoId && reset(photoId)} title="Reset to the automatic edit">
        ⟲<span className="btn-text">Reset</span>
      </button>
      {zoomPercent !== null && <span className="zoom-readout">{Math.round(zoomPercent * 100)}%</span>}
    </div>
  );
}
