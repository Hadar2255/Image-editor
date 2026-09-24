import { create } from 'zustand';
import type { RawMeta } from '../raw/rawLoader.ts';

export type PhotoStatus = 'queued' | 'reading' | 'decoding' | 'ready' | 'error';

export interface Photo {
  id: string;
  name: string;
  size: number;
  file: File;
  status: PhotoStatus;
  thumbUrl?: string;
  meta?: RawMeta;
  /** Size of the decoded editing preview. */
  previewSize?: { width: number; height: number };
  decodeMs?: number;
  error?: string;
}

interface PhotoState {
  photos: Photo[];
  activeId: string | null;
  add: (files: File[]) => Photo[];
  update: (id: string, patch: Partial<Photo>) => void;
  setActive: (id: string) => void;
  remove: (id: string) => void;
}

let nextId = 1;

export const usePhotoStore = create<PhotoState>((set, get) => ({
  photos: [],
  activeId: null,
  add: (files) => {
    const added: Photo[] = files.map((file) => ({
      id: `p${nextId++}`,
      name: file.name,
      size: file.size,
      file,
      status: 'queued',
    }));
    set((s) => ({ photos: [...s.photos, ...added], activeId: s.activeId ?? added[0]?.id ?? null }));
    return added;
  },
  update: (id, patch) =>
    set((s) => ({ photos: s.photos.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
  setActive: (id) => set({ activeId: id }),
  remove: (id) => {
    const { photos, activeId } = get();
    const idx = photos.findIndex((p) => p.id === id);
    const photo = photos[idx];
    if (photo?.thumbUrl) URL.revokeObjectURL(photo.thumbUrl);
    const rest = photos.filter((p) => p.id !== id);
    const nextActive = activeId === id ? (rest[Math.min(idx, rest.length - 1)]?.id ?? null) : activeId;
    set({ photos: rest, activeId: nextActive });
  },
}));

export const useActivePhoto = () =>
  usePhotoStore((s) => s.photos.find((p) => p.id === s.activeId) ?? null);

if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__photoStore = usePhotoStore;
