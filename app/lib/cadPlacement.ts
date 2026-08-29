/**
 * CAD placement sidecar + BIM spawn profiles for AgentSamEngine.
 * Schema: iam.cad.placement.v1
 */

export const PLACEMENT_SIDECAR_SCHEMA = 'iam.cad.placement.v1' as const;

export type CadSpawnProfile = 'preview' | 'bim';

export type CadPlacementSidecar = {
  schema: typeof PLACEMENT_SIDECAR_SCHEMA;
  units: 'mm' | 'm' | 'in';
  /** Source CAD document up axis (FreeCAD/OpenSCAD). */
  up_axis: 'Y' | 'Z';
  /** GLB file up axis after export pipeline (Blender glTF is typically Y). */
  glb_up_axis?: 'Y' | 'Z';
  bbox_mm: {
    min: [number, number, number];
    max: [number, number, number];
  };
  placement: {
    position_mm: [number, number, number];
    rotation_euler_deg: [number, number, number];
  };
  spawn?: {
    profile?: CadSpawnProfile;
    fit_to_viewport?: boolean;
  };
  source_fcstd?: string;
  cad_job_id?: string;
};

export type EntitySpatialSnapshot = {
  units: 'm' | 'mm' | 'scene';
  world_bbox: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
    size: { x: number; y: number; z: number };
  };
  rotation_euler_deg: { x: number; y: number; z: number };
  entity_position: { x: number; y: number; z: number };
  visual_scale: number;
  ground_y: number;
  spawn_profile: CadSpawnProfile;
  up_axis?: 'Y' | 'Z';
  source_units?: string;
};

export function sidecarUrlForGlb(glbUrl: string): string {
  const raw = String(glbUrl || '').trim();
  if (!raw) return '';
  return raw.replace(/\.glb(\?.*)?$/i, '.placement.json');
}

export function parsePlacementSidecar(raw: unknown): CadPlacementSidecar | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (String(o.schema || '') !== PLACEMENT_SIDECAR_SCHEMA) return null;
  const units = String(o.units || 'mm').toLowerCase();
  if (units !== 'mm' && units !== 'm' && units !== 'in') return null;
  const up = String(o.up_axis || 'Z').toUpperCase();
  const glbUpRaw = String(o.glb_up_axis || '').toUpperCase();
  const glbUp = glbUpRaw === 'Y' || glbUpRaw === 'Z' ? glbUpRaw : undefined;
  const bbox = o.bbox_mm as Record<string, unknown> | undefined;
  const placement = o.placement as Record<string, unknown> | undefined;
  if (!bbox || !placement) return null;
  const min = Array.isArray(bbox.min) ? bbox.min : null;
  const max = Array.isArray(bbox.max) ? bbox.max : null;
  const pos = Array.isArray(placement.position_mm) ? placement.position_mm : null;
  const rot = Array.isArray(placement.rotation_euler_deg) ? placement.rotation_euler_deg : null;
  if (!min || !max || !pos || !rot) return null;
  const spawnRaw = o.spawn && typeof o.spawn === 'object' ? (o.spawn as Record<string, unknown>) : {};
  return {
    schema: PLACEMENT_SIDECAR_SCHEMA,
    units: units as CadPlacementSidecar['units'],
    up_axis: up === 'Y' ? 'Y' : 'Z',
    glb_up_axis: glbUp === 'Y' || glbUp === 'Z' ? glbUp : undefined,
    bbox_mm: {
      min: [Number(min[0]) || 0, Number(min[1]) || 0, Number(min[2]) || 0],
      max: [Number(max[0]) || 0, Number(max[1]) || 0, Number(max[2]) || 0],
    },
    placement: {
      position_mm: [Number(pos[0]) || 0, Number(pos[1]) || 0, Number(pos[2]) || 0],
      rotation_euler_deg: [Number(rot[0]) || 0, Number(rot[1]) || 0, Number(rot[2]) || 0],
    },
    spawn: {
      profile: spawnRaw.profile === 'preview' ? 'preview' : 'bim',
      fit_to_viewport: spawnRaw.fit_to_viewport === true,
    },
    source_fcstd:
      o.source_fcstd != null ? String(o.source_fcstd) : undefined,
    cad_job_id: o.cad_job_id != null ? String(o.cad_job_id) : undefined,
  };
}

export async function fetchPlacementSidecarForGlb(glbUrl: string): Promise<CadPlacementSidecar | null> {
  const url = sidecarUrlForGlb(glbUrl);
  if (!url) return null;
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return null;
    return parsePlacementSidecar(await res.json());
  } catch {
    return null;
  }
}

export function spawnMetadataFromSidecar(sidecar: CadPlacementSidecar): Record<string, unknown> {
  const profile = sidecar.spawn?.profile ?? 'bim';
  return {
    spawn_profile: profile,
    placement_sidecar: sidecar,
    source_units: sidecar.units,
    up_axis: sidecar.up_axis,
    glb_up_axis: sidecar.glb_up_axis,
    fit_to_viewport: sidecar.spawn?.fit_to_viewport === true,
    proof_lane: profile === 'bim' ? 'bim' : undefined,
    source_fcstd: sidecar.source_fcstd,
    cad_job_id: sidecar.cad_job_id,
  };
}

export function unitScaleForProfile(
  profile: CadSpawnProfile,
  units: string | undefined,
): number {
  if (profile !== 'bim') return 1;
  const u = String(units || 'mm').toLowerCase();
  if (u === 'mm') return 0.001;
  if (u === 'in') return 0.0254;
  return 1;
}
