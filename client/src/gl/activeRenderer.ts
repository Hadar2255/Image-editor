import type { Renderer } from './Renderer.ts';

/** The viewer's renderer and the photo it currently shows, for actions outside the viewer (AI, export). */
let current: { renderer: Renderer; photoId: string | null } | null = null;

export function setActiveRenderer(renderer: Renderer | null, photoId: string | null = null) {
  current = renderer ? { renderer, photoId } : null;
}

/** The renderer, but only if it is showing `photoId`. */
export function rendererFor(photoId: string): Renderer | null {
  return current && current.photoId === photoId ? current.renderer : null;
}
