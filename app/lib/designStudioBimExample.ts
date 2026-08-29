/**
 * Design Studio — BIMExample.FCStd showcase (FreeCAD → GLB on R2).
 * SSOT for UI spawn + D1 stock row `ds_stock_bim_example` (migration 772).
 */
import { normalizeGlbUrl } from '@inneranimalmedia/client-3d-runtime/assets';
import type { GalleryItem } from '../components/designstudio/cad-studio/cadStudioTypes';

/** Platform stock assets — never tenant- or workspace-scoped export paths. */
const BIM_STOCK_BASE = '/assets/cad/stock/bim-example';

export const DESIGN_STUDIO_BIM_EXAMPLE = {
  id: 'ds_stock_bim_example',
  name: 'BIM Example (FreeCAD)',
  url: `${BIM_STOCK_BASE}/cadj_bimexample311065.glb`,
  /** BIM profile: true scale (mm→m); sidecar drives orientation + fit_to_viewport */
  scale: 1,
  placementSidecarUrl: `${BIM_STOCK_BASE}/cadj_bimexample311065.placement.json`,
  cadJobId: 'cadj_bimexample311065',
  sourceFile: 'BIMExample.FCStd',
  engine: 'freecad',
  tags: 'designstudio,stock,bim,freecad,featured',
} as const;

export function designStudioBimGalleryItem(): GalleryItem {
  const url = normalizeGlbUrl(DESIGN_STUDIO_BIM_EXAMPLE.url) ?? DESIGN_STUDIO_BIM_EXAMPLE.url;
  return {
    id: DESIGN_STUDIO_BIM_EXAMPLE.id,
    cadJobId: DESIGN_STUDIO_BIM_EXAMPLE.cadJobId,
    name: DESIGN_STUDIO_BIM_EXAMPLE.name,
    url,
    source: 'stock',
    scale: DESIGN_STUDIO_BIM_EXAMPLE.scale,
    status: 'done',
  };
}

export function isDesignStudioBimExampleUrl(url: string | null | undefined): boolean {
  const raw = String(url || '').trim().toLowerCase();
  if (!raw) return false;
  return (
    raw.includes('cadj_bimexample311065') ||
    raw.includes('ds_stock_bim_example') ||
    raw.includes('/assets/cad/stock/bim-example/')
  );
}
