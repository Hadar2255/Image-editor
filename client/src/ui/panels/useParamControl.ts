import type { EditParams } from '@raw/shared';
import { useEditStore, useParams } from '../../state/editStore.ts';

/** Binds a slider to one numeric field of the photo's edit params. */
export function useParamControl(photoId: string) {
  const params = useParams(photoId);
  const update = useEditStore((s) => s.update);
  const commit = useEditStore((s) => s.commit);
  return (get: (p: EditParams) => number, set: (draft: EditParams, v: number) => void) => ({
    value: get(params),
    onChange: (v: number) => update(photoId, (d) => set(d, v), { transient: true }),
    onCommit: () => commit(photoId),
  });
}
