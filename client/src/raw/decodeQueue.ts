import { decodeLinear, readThumbnail, type LinearImage } from './rawLoader.ts';
import { usePhotoStore } from '../state/photoStore.ts';

/**
 * RAW decoding is memory hungry (each LibRaw instance reserves a large WASM
 * heap), so jobs run strictly one at a time. Preview decodes of the photo the
 * user is looking at jump ahead of background thumbnail reads.
 */
type Job = () => Promise<void>;
const queues: Record<'high' | 'low', Job[]> = { high: [], low: [] };
let running = false;

async function pump() {
  if (running) return;
  running = true;
  let job: Job | undefined;
  while ((job = queues.high.shift() ?? queues.low.shift())) await job();
  running = false;
}

function serial<T>(fn: () => Promise<T>, priority: 'high' | 'low' = 'low'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queues[priority].push(() => fn().then(resolve, reject));
    void pump();
  });
}

/** Decoded editing previews, kept for the few most recently viewed photos. */
const PREVIEW_CACHE_SIZE = 3;
const previews = new Map<string, LinearImage>();
const inflight = new Map<string, Promise<LinearImage>>();

function remember(id: string, img: LinearImage) {
  previews.delete(id);
  previews.set(id, img);
  while (previews.size > PREVIEW_CACHE_SIZE) {
    const oldest = previews.keys().next().value!;
    previews.delete(oldest);
  }
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function loadThumbnails(ids: string[]): void {
  const { update } = usePhotoStore.getState();
  for (const id of ids) {
    void serial(async () => {
      const photo = usePhotoStore.getState().photos.find((p) => p.id === id);
      if (!photo || photo.meta || photo.status === 'error') return;
      const wasQueued = photo.status === 'queued';
      if (wasQueued) update(id, { status: 'reading' });
      try {
        const { meta, thumb } = await readThumbnail(photo.file);
        update(id, {
          meta,
          thumbUrl: thumb ? URL.createObjectURL(thumb) : undefined,
          ...(wasQueued && { status: 'queued' as const }),
        });
      } catch (e) {
        if (wasQueued) update(id, { status: 'error', error: errorMessage(e) });
      }
    });
  }
}

export function getPreview(id: string): LinearImage | undefined {
  const img = previews.get(id);
  if (img) remember(id, img);
  return img;
}

export function loadPreview(id: string): Promise<LinearImage> {
  const cached = getPreview(id);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(id);
  if (pending) return pending;

  const { update } = usePhotoStore.getState();
  const job = serial(async () => {
    const photo = usePhotoStore.getState().photos.find((p) => p.id === id);
    if (!photo) throw new Error('Photo was removed');
    update(id, { status: 'decoding' });
    const t0 = performance.now();
    try {
      const img = await decodeLinear(photo.file, { halfSize: true });
      remember(id, img);
      update(id, {
        status: 'ready',
        previewSize: { width: img.width, height: img.height },
        decodeMs: Math.round(performance.now() - t0),
      });
      return img;
    } catch (e) {
      update(id, { status: 'error', error: errorMessage(e) });
      throw e;
    }
  }, 'high').finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

export function forgetPreview(id: string) {
  previews.delete(id);
}
