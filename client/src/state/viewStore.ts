import { create } from 'zustand';
import type { Histogram } from '../gl/Renderer.ts';
import { FIT_VIEW, type ViewTransform } from '../gl/viewMath.ts';

interface ViewState {
  view: ViewTransform;
  /** Before/after divider as a fraction of the viewer width, null = off. */
  split: number | null;
  showBefore: boolean;
  histogram: Histogram | null;
  /** Zoom relative to full sensor resolution (1 = 100%). */
  zoomPercent: number | null;
  setView: (v: ViewTransform) => void;
  toggleSplit: () => void;
  setSplit: (s: number | null) => void;
  setShowBefore: (b: boolean) => void;
  setHistogram: (h: Histogram | null) => void;
  setZoomPercent: (z: number | null) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  view: FIT_VIEW,
  split: null,
  showBefore: false,
  histogram: null,
  zoomPercent: null,
  setView: (view) => set({ view }),
  toggleSplit: () => set((s) => ({ split: s.split === null ? 0.5 : null })),
  setSplit: (split) => set({ split }),
  setShowBefore: (showBefore) => set({ showBefore }),
  setHistogram: (histogram) => set({ histogram }),
  setZoomPercent: (zoomPercent) => set({ zoomPercent }),
}));
