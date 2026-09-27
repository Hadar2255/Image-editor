import { defaultEditParams, paramsEqual, type EditParams } from '@raw/shared';
import type { LinearImage, RawMeta } from '../raw/rawLoader.ts';
import type { Renderer } from '../gl/Renderer.ts';
import { rendererFor } from '../gl/activeRenderer.ts';
import { computeStats, downsampleLuma, type ImageStats } from '../analysis/stats.ts';
import { histogramAutoEdit } from '../analysis/autoAdjust.ts';
import { detectTilt } from '../analysis/horizon.ts';
import { analyze, ApiError, blobToBase64, getHealth, instruct } from '../api/client.ts';
import { useAnalysisStore } from '../state/analysisStore.ts';
import { useEditStore } from '../state/editStore.ts';
import { usePhotoStore } from '../state/photoStore.ts';

const ANALYZE_SIDE = 1024;
const INSTRUCT_SIDE = 768;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const meta = (id: string) => usePhotoStore.getState().photos.find((p) => p.id === id)?.meta;

/** What we tell Claude about the capture (compact, human-readable). */
function describeMeta(m?: RawMeta) {
  if (!m) return {};
  return {
    camera: `${m.make} ${m.model}`.trim(),
    lens: m.lens || undefined,
    iso: m.iso,
    shutter: m.shutter >= 1 ? `${m.shutter}s` : `1/${Math.round(1 / m.shutter)}s`,
    aperture: `f/${m.aperture.toFixed(1)}`,
    focalLength: `${Math.round(m.focalLength)}mm`,
  };
}

function describeStats(s: ImageStats) {
  const r = (v: number) => Number(v.toPrecision(3));
  return {
    luminancePercentiles: Object.fromEntries(Object.entries(s.p).map(([k, v]) => [k, r(v)])),
    geometricMean: r(s.geoMean),
    clippedFraction: r(s.clipped),
    note: 'scene-linear luminance, 1.0 = sensor clipping; middle grey renders from 0.18',
  };
}

/**
 * First look at a freshly decoded photo:
 * 1. histogram-based edit, applied instantly (and kept if Claude is unavailable);
 * 2. Claude's analysis in the background, applied when it arrives unless the
 *    user has started editing (then it waits in the panel for a click).
 * Runs once per photo.
 */
export async function runAutoEdit(photoId: string, image: LinearImage, renderer: Renderer) {
  const analyses = useAnalysisStore.getState();
  if (analyses.byPhoto[photoId]) return;

  const stats = computeStats(image);
  rememberStats(photoId, stats);
  const tilt = detectTilt(downsampleLuma(image));
  const auto = histogramAutoEdit(stats, meta(photoId));
  const edits = useEditStore.getState();
  if (!edits.edits[photoId]) edits.setBaseline(photoId, auto, { apply: true });
  analyses.set(photoId, {
    status: 'analyzing',
    source: 'histogram',
    suggestion: tilt ? { angle: tilt, crop: null, source: 'histogram' } : undefined,
  });

  // Render the neutral image now, while the renderer is guaranteed to show this photo.
  let jpeg: Blob;
  try {
    jpeg = await renderer.renderJpeg(defaultEditParams(), ANALYZE_SIDE);
  } catch (e) {
    analyses.set(photoId, { status: 'error', error: errorText(e) });
    return;
  }
  await requestClaudeEdit(photoId, jpeg, stats, auto);
}

async function requestClaudeEdit(
  photoId: string,
  jpeg: Blob,
  stats: ImageStats,
  histogramEdit: EditParams,
  forceApply = false,
) {
  const setAnalysis = (patch: Parameters<ReturnType<typeof useAnalysisStore.getState>['set']>[1]) =>
    useAnalysisStore.getState().set(photoId, patch);
  try {
    const health = await getHealth();
    if (!health.claudeConfigured) {
      setAnalysis({ status: 'unavailable', error: 'No ANTHROPIC_API_KEY on the server — using the histogram edit.' });
      return;
    }
  } catch (e) {
    setAnalysis({ status: 'unavailable', error: `API server unreachable (${errorText(e)})` });
    return;
  }

  setAnalysis({ status: 'analyzing', error: undefined });
  try {
    const res = await analyze({
      image: await blobToBase64(jpeg),
      meta: describeMeta(meta(photoId)),
      stats: describeStats(stats),
      suggestion: histogramEdit,
    });
    const edit = useEditStore.getState().edits[photoId];
    const untouched = forceApply || !edit || paramsEqual(edit.params, edit.baseline);
    const geometry = res.geometry.angle !== 0 || res.geometry.crop ? { ...res.geometry, source: 'claude' as const } : undefined;
    if (untouched) {
      useEditStore.getState().setBaseline(photoId, res.params, { apply: true });
      setAnalysis({ status: 'done', source: 'claude', sceneType: res.sceneType, reasoning: res.reasoning, pending: undefined });
    } else {
      setAnalysis({
        status: 'done',
        pending: { params: res.params, sceneType: res.sceneType, reasoning: res.reasoning },
      });
    }
    if (geometry) setAnalysis({ suggestion: geometry });
  } catch (e) {
    const unavailable = e instanceof ApiError && e.code === 'unconfigured';
    setAnalysis({ status: unavailable ? 'unavailable' : 'error', error: errorText(e) });
  }
}

/** Re-run Claude's analysis for the photo on screen. */
export async function reanalyze(photoId: string) {
  const renderer = rendererFor(photoId);
  if (!renderer) return;
  const edit = useEditStore.getState().edits[photoId];
  useAnalysisStore.getState().set(photoId, { status: 'analyzing', error: undefined, pending: undefined });
  try {
    const jpeg = await renderer.renderJpeg(defaultEditParams(), ANALYZE_SIDE);
    const stats = lastStats.get(photoId) ?? emptyStats(renderer.imageSize);
    // The user explicitly asked, so apply the result even if they have edited since.
    await requestClaudeEdit(photoId, jpeg, stats, edit?.baseline ?? defaultEditParams(), true);
  } catch (e) {
    useAnalysisStore.getState().set(photoId, { status: 'error', error: errorText(e) });
  }
}

/** Apply Claude's held-back edit. */
export function applyPending(photoId: string) {
  const a = useAnalysisStore.getState().byPhoto[photoId];
  if (!a?.pending) return;
  useEditStore.getState().setBaseline(photoId, a.pending.params, { apply: true });
  useAnalysisStore.getState().set(photoId, {
    source: 'claude',
    sceneType: a.pending.sceneType,
    reasoning: a.pending.reasoning,
    pending: undefined,
  });
}

/** Free-text edit request ("warmer and more cinematic"). Returns Claude's explanation. */
export async function requestInstruction(photoId: string, instruction: string): Promise<string> {
  const renderer = rendererFor(photoId);
  if (!renderer) throw new Error('The photo is still loading');
  const params = useEditStore.getState().edits[photoId]?.params ?? defaultEditParams();
  const jpeg = await renderer.renderJpeg(params, INSTRUCT_SIDE);
  const res = await instruct({ image: await blobToBase64(jpeg), params, instruction });
  useEditStore.getState().set(photoId, res.params);
  return res.explanation;
}

// Stats are cheap to keep and let "re-analyze" skip recomputing from pixels.
const lastStats = new Map<string, ImageStats>();
export function rememberStats(photoId: string, stats: ImageStats) {
  lastStats.set(photoId, stats);
}
function emptyStats(size: { width: number; height: number } | null): ImageStats {
  const zero = { p001: 0, p01: 0, p05: 0, p25: 0, p50: 0, p75: 0, p95: 0, p99: 0, p995: 0, p999: 0 };
  return { width: size?.width ?? 0, height: size?.height ?? 0, p: zero, geoMean: 0, clipped: 0, neutral: null, neutralFraction: 0 };
}
