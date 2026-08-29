/** Meshy product rail — matches Meshy workspace tool surfaces. */
export type MeshyRailTool =
  | 'text-to-3d'
  | 'image-to-3d'
  | 'text-to-texture'
  | 'texture'
  | 'animate'
  | 'post-process'
  | 'image'
  | 'print';

export type StudioSegment = 'meshy' | 'cad' | 'motion' | 'animation' | 'advanced';

export const MESHY_RAIL_TOOLS: {
  id: MeshyRailTool;
  label: string;
  shortLabel: string;
}[] = [
  { id: 'text-to-3d', label: 'Text to 3D', shortLabel: 'Text' },
  { id: 'image-to-3d', label: 'Image to 3D', shortLabel: 'Image3D' },
  { id: 'text-to-texture', label: 'Text to Texture', shortLabel: 'TexGen' },
  { id: 'texture', label: 'Texture', shortLabel: 'Texture' },
  { id: 'animate', label: 'Animate', shortLabel: 'Animate' },
  { id: 'post-process', label: 'Post-Process', shortLabel: 'Post' },
  { id: 'image', label: 'Image', shortLabel: 'Image' },
  { id: 'print', label: '3D Print', shortLabel: 'Print' },
];

export const STUDIO_SEGMENTS: { id: StudioSegment; label: string }[] = [
  { id: 'meshy', label: 'Meshy' },
  { id: 'cad', label: 'CAD' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'motion', label: 'Motion' },
  { id: 'animation', label: 'Animation' },
];

const RAIL_KEY = 'iam_ds_meshy_rail_v1';
const SEG_KEY = 'iam_ds_studio_seg_v1';

export function readStoredMeshyRail(): MeshyRailTool {
  if (typeof window === 'undefined') return 'text-to-3d';
  try {
    const v = sessionStorage.getItem(RAIL_KEY);
    if (v && MESHY_RAIL_TOOLS.some((t) => t.id === v)) return v as MeshyRailTool;
  } catch { /* */ }
  return 'text-to-3d';
}

export function persistMeshyRail(tool: MeshyRailTool) {
  try {
    sessionStorage.setItem(RAIL_KEY, tool);
  } catch { /* */ }
}

export function readStoredStudioSegment(): StudioSegment {
  if (typeof window === 'undefined') return 'meshy';
  try {
    const v = sessionStorage.getItem(SEG_KEY);
    if (v === 'meshy' || v === 'cad' || v === 'motion' || v === 'animation' || v === 'advanced') return v;
  } catch { /* */ }
  return 'meshy';
}

export function persistStudioSegment(seg: StudioSegment) {
  try {
    sessionStorage.setItem(SEG_KEY, seg);
  } catch { /* */ }
}
