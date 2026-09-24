import LibRaw, { type LibRawSettings, type Metadata } from 'libraw-wasm';

export const RAW_EXTENSIONS = [
  'arw', 'srf', 'sr2', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'dng', 'raf',
  'orf', 'rw2', 'pef', 'srw', 'x3f', '3fr', 'iiq', 'rwl',
];

export function isRawFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return RAW_EXTENSIONS.includes(ext);
}

export interface RawMeta {
  make: string;
  model: string;
  lens: string;
  iso: number;
  /** Seconds. */
  shutter: number;
  aperture: number;
  focalLength: number;
  timestamp: number | null;
  /** Sensor output size (before half-size), after orientation. */
  width: number;
  height: number;
}

/**
 * Scene-referred linear RGB (sRGB primaries, camera white balance applied,
 * no tone curve). Interleaved RGB, 0..65535 where 65535 is sensor clipping.
 */
export interface LinearImage {
  width: number;
  height: number;
  data: Uint16Array;
}

const LINEAR_SETTINGS: LibRawSettings = {
  outputBps: 16,
  outputColor: 1, // sRGB primaries
  gamm: [1, 1], // linear output, tone mapping happens on the GPU
  noAutoBright: true,
  useCameraWb: true,
  highlight: 0, // clip; highlight recovery is done in the edit pipeline
  userFlip: -1, // honour the camera orientation
};

/** Each job gets its own LibRaw instance, disposed right after to release WASM memory. */
async function withLibRaw<T>(file: File, settings: LibRawSettings, fn: (raw: LibRaw) => Promise<T>): Promise<T> {
  const raw = new LibRaw();
  try {
    // LibRaw transfers the buffer to its worker, so always hand it a fresh one.
    const bytes = new Uint8Array(await file.arrayBuffer());
    await raw.open(bytes, settings);
    return await fn(raw);
  } finally {
    raw.dispose();
  }
}

function toRawMeta(m: Metadata): RawMeta {
  const rotated = m.flip === 5 || m.flip === 6;
  return {
    make: m.camera_make?.trim() ?? '',
    model: m.camera_model?.trim() ?? '',
    lens: m.lens?.Lens?.trim() || m.lens?.makernotes?.Lens?.trim() || '',
    iso: m.iso_speed,
    shutter: m.shutter,
    aperture: m.aperture,
    focalLength: m.focal_len,
    timestamp: m.timestamp instanceof Date && !isNaN(m.timestamp.getTime()) ? m.timestamp.getTime() : null,
    width: rotated ? m.height : m.width,
    height: rotated ? m.width : m.height,
  };
}

/** Fast path: metadata + the camera's embedded JPEG preview (no demosaicing). */
export async function readThumbnail(file: File): Promise<{ meta: RawMeta; thumb: Blob | null }> {
  return withLibRaw(file, LINEAR_SETTINGS, async (raw) => {
    const meta = await raw.metadata(true);
    if (!meta) throw new Error('Unsupported or corrupt RAW file');
    let thumb: Blob | null = null;
    try {
      const t = await raw.thumbnailData();
      if (t && t.format === 'jpeg' && t.data.length > 0) {
        thumb = new Blob([t.data as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
      }
    } catch {
      // Some files carry no usable preview; the decoded image will be shown instead.
    }
    return { meta: toRawMeta(meta), thumb };
  });
}

/**
 * Demosaic to linear RGB. `halfSize` merges each 2x2 Bayer block (4x fewer
 * pixels, much faster) and is used for interactive editing; full size is
 * only decoded for export.
 */
export async function decodeLinear(file: File, opts: { halfSize: boolean }): Promise<LinearImage> {
  const settings: LibRawSettings = {
    ...LINEAR_SETTINGS,
    halfSize: opts.halfSize,
    userQual: opts.halfSize ? 0 : 3, // AHD demosaic for full-size output
  };
  return withLibRaw(file, settings, async (raw) => {
    const img = await raw.imageData();
    if (!img) throw new Error('LibRaw returned no image data');
    if (img.colors !== 3 || img.bits !== 16 || !(img.data instanceof Uint16Array)) {
      throw new Error(`Unexpected LibRaw output: ${img.colors} colors, ${img.bits} bits`);
    }
    return { width: img.width, height: img.height, data: img.data };
  });
}
