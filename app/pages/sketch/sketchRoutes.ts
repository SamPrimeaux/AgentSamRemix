/** Sketch studio routes — separate from Excalidraw /draw. */

export const SKETCH_PATH = '/dashboard/sketch';
export const DRAW_PATH = '/dashboard/draw';

export type SketchSurface = 'sketch' | 'wireframe';

/** Map legacy open_surface values to sketch studio path. */
export function sketchPathForSurface(surface?: string | null): string {
  const s = String(surface || '').trim().toLowerCase();
  if (s === 'sketch' || s === 'wireframe' || s === 'studio' || s === 'figma') return SKETCH_PATH;
  return DRAW_PATH;
}
