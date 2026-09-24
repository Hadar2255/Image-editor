import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RAW_EXTENSIONS } from '../raw/rawLoader.ts';

/** Whole-window drop target with a highlight overlay while dragging files. */
export function DropZone({ onFiles, children }: { onFiles: (files: File[]) => void; children: ReactNode }) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      onFiles(Array.from(e.dataTransfer!.files));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [onFiles]);

  return (
    <>
      {children}
      {dragging && (
        <div className="drop-overlay">
          <div>Drop to open</div>
        </div>
      )}
    </>
  );
}

export function FilePickerButton({
  onFiles,
  children,
  primary,
}: {
  onFiles: (files: File[]) => void;
  children: ReactNode;
  primary?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className={primary ? 'btn primary' : 'btn'} onClick={() => input.current?.click()}>
        {children}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={RAW_EXTENSIONS.map((e) => `.${e}`).join(',')}
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </>
  );
}
