import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { defaultEditParams, paramsEqual, type EditParams } from '@raw/shared';

const HISTORY_LIMIT = 100;

export interface PhotoEdit {
  params: EditParams;
  past: EditParams[];
  future: EditParams[];
  /** Params at the start of the current slider drag, merged into one undo step on commit. */
  gestureBase: EditParams | null;
  /** What "reset" returns to (the automatic edit from stage 3, defaults until then). */
  baseline: EditParams;
}

interface EditState {
  edits: Record<string, PhotoEdit>;
  /**
   * Apply a change. `transient` updates (slider drags) don't create history
   * entries until `commit()` is called.
   */
  update: (id: string, recipe: (draft: EditParams) => void, opts?: { transient?: boolean }) => void;
  set: (id: string, params: EditParams) => void;
  commit: (id: string) => void;
  undo: (id: string) => void;
  redo: (id: string) => void;
  reset: (id: string) => void;
  /** Set what "reset" returns to (the automatic edit); optionally apply it as one undo step. */
  setBaseline: (id: string, params: EditParams, opts?: { apply?: boolean }) => void;
  remove: (id: string) => void;
}

const fresh = (): PhotoEdit => {
  const params = defaultEditParams();
  return { params, past: [], future: [], gestureBase: null, baseline: params };
};

const pushPast = (past: EditParams[], p: EditParams) => [...past, p].slice(-HISTORY_LIMIT);

export const useEditStore = create<EditState>((set, get) => {
  const edit = (id: string) => get().edits[id] ?? fresh();
  const put = (id: string, e: PhotoEdit) => set((s) => ({ edits: { ...s.edits, [id]: e } }));

  /** Record `next` as a new state (one undo step), folding in any open gesture. */
  const apply = (id: string, next: EditParams) => {
    const e = edit(id);
    const base = e.gestureBase ?? e.params;
    if (paramsEqual(base, next)) {
      put(id, { ...e, params: next, gestureBase: null });
      return;
    }
    put(id, { ...e, params: next, past: pushPast(e.past, base), future: [], gestureBase: null });
  };

  return {
    edits: {},
    update: (id, recipe, opts) => {
      const e = edit(id);
      const draft = structuredClone(e.params);
      recipe(draft);
      if (opts?.transient) {
        put(id, { ...e, params: draft, gestureBase: e.gestureBase ?? e.params });
      } else {
        apply(id, draft);
      }
    },
    set: (id, params) => apply(id, params),
    commit: (id) => {
      const e = edit(id);
      if (e.gestureBase) apply(id, e.params);
    },
    undo: (id) => {
      const e = edit(id);
      if (e.gestureBase) {
        // Undo during/after an uncommitted drag: back to where the drag started.
        put(id, { ...e, params: e.gestureBase, future: [e.params, ...e.future], gestureBase: null });
        return;
      }
      const current = e.params;
      const prev = e.past[e.past.length - 1];
      if (!prev) return;
      put(id, { ...e, params: prev, past: e.past.slice(0, -1), future: [current, ...e.future], gestureBase: null });
    },
    redo: (id) => {
      const e = edit(id);
      const next = e.future[0];
      if (!next) return;
      put(id, { ...e, params: next, past: pushPast(e.past, e.params), future: e.future.slice(1), gestureBase: null });
    },
    reset: (id) => apply(id, structuredClone(edit(id).baseline)),
    setBaseline: (id, params, opts) => {
      put(id, { ...edit(id), baseline: params });
      if (opts?.apply) apply(id, structuredClone(params));
    },
    remove: (id) =>
      set((s) => {
        const { [id]: _removed, ...rest } = s.edits;
        return { edits: rest };
      }),
  };
});

const DEFAULTS = defaultEditParams();

/** Params of a photo (defaults for photos not edited yet). */
export const useParams = (id: string | null) => useEditStore((s) => (id && s.edits[id]?.params) || DEFAULTS);

export const useHistoryState = (id: string | null) =>
  useEditStore(
    useShallow((s) => {
      const e = id ? s.edits[id] : undefined;
      return {
        canUndo: !!e && (e.past.length > 0 || !!e.gestureBase),
        canRedo: !!e && e.future.length > 0,
        isEdited: !!e && !paramsEqual(e.params, e.baseline),
      };
    }),
  );

if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__editStore = useEditStore;
