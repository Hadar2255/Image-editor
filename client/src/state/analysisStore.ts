import { create } from 'zustand';
import type { CropRect, EditParams } from '@raw/shared';

export type AnalysisStatus = 'analyzing' | 'done' | 'error' | 'unavailable';

export interface GeometrySuggestion {
  angle: number;
  crop: CropRect | null;
  source: 'claude' | 'histogram';
}

export interface PhotoAnalysis {
  status: AnalysisStatus;
  /** Which edit the "auto" baseline currently is. */
  source: 'histogram' | 'claude';
  sceneType?: string;
  reasoning?: string;
  error?: string;
  /** Claude's edit, held back because the user had already started editing. */
  pending?: { params: EditParams; sceneType: string; reasoning: string };
  suggestion?: GeometrySuggestion;
}

const DEFAULT_ANALYSIS: PhotoAnalysis = { status: 'analyzing', source: 'histogram' };

interface AnalysisState {
  byPhoto: Record<string, PhotoAnalysis>;
  set: (id: string, patch: Partial<PhotoAnalysis>) => void;
  remove: (id: string) => void;
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  byPhoto: {},
  set: (id, patch) =>
    set((s) => ({
      byPhoto: { ...s.byPhoto, [id]: { ...(s.byPhoto[id] ?? DEFAULT_ANALYSIS), ...patch } },
    })),
  remove: (id) =>
    set((s) => {
      const { [id]: _removed, ...rest } = s.byPhoto;
      return { byPhoto: rest };
    }),
}));

export const useAnalysis = (id: string | null) => useAnalysisStore((s) => (id ? s.byPhoto[id] : undefined));
