/**
 * Spatial helpers for AgentSamEngine — bbox, axes, BIM placement.
 */
import * as THREE from 'three';
import type { GameEntity } from '../types';
import {
  type CadPlacementSidecar,
  type CadSpawnProfile,
  type EntitySpatialSnapshot,
  unitScaleForProfile,
} from '../lib/cadPlacement';

export function createAxesHelper(size: number, opacity = 0.85): THREE.Group {
  const group = new THREE.Group();
  const axes = new THREE.AxesHelper(Math.max(0.1, size));
  axes.renderOrder = 999;
  axes.traverse((obj) => {
    const line = obj as THREE.Line;
    if (line.material && 'opacity' in line.material) {
      (line.material as THREE.Material).transparent = true;
      (line.material as THREE.Material).opacity = opacity;
      (line.material as THREE.Material).depthTest = false;
    }
  });
  group.add(axes);
  return group;
}

export function worldBoxFromObject(obj: THREE.Object3D): THREE.Box3 {
  return new THREE.Box3().setFromObject(obj);
}

export function boxToSnapshot(box: THREE.Box3): EntitySpatialSnapshot['world_bbox'] {
  const min = box.min;
  const max = box.max;
  const size = new THREE.Vector3();
  box.getSize(size);
  return {
    min: { x: min.x, y: min.y, z: min.z },
    max: { x: max.x, y: max.y, z: max.z },
    size: { x: size.x, y: size.y, z: size.z },
  };
}

export function eulerDegFromObject(obj: THREE.Object3D): { x: number; y: number; z: number } {
  const e = new THREE.Euler().setFromQuaternion(obj.quaternion, 'XYZ');
  return {
    x: THREE.MathUtils.radToDeg(e.x),
    y: THREE.MathUtils.radToDeg(e.y),
    z: THREE.MathUtils.radToDeg(e.z),
  };
}

export function resolveSpawnProfile(entity: GameEntity): {
  profile: CadSpawnProfile;
  sidecar: CadPlacementSidecar | null;
  fitToViewport: boolean;
  unitScale: number;
} {
  const meta = (entity.behavior?.metadata ?? {}) as Record<string, unknown>;
  const sidecar =
    meta.placement_sidecar && typeof meta.placement_sidecar === 'object'
      ? (meta.placement_sidecar as CadPlacementSidecar)
      : null;
  const profile =
    meta.spawn_profile === 'bim' || sidecar?.spawn?.profile === 'bim' ? 'bim' : 'preview';
  const fitToViewport =
    meta.fit_to_viewport === true ||
    sidecar?.spawn?.fit_to_viewport === true ||
    (profile !== 'bim' && !(entity.scale != null && entity.scale > 0));
  const unitScale = unitScaleForProfile(
    profile,
    sidecar?.units ?? (meta.source_units != null ? String(meta.source_units) : undefined),
  );
  return { profile, sidecar, fitToViewport, unitScale };
}

/** Resolve GLB file up-axis (after export). Defaults Y for BIM pipeline (STL→Blender→GLB). */
export function resolveGlbUpAxis(
  sidecar: CadPlacementSidecar | null,
  meta?: Record<string, unknown> | null,
): 'Y' | 'Z' | null {
  if (sidecar?.glb_up_axis === 'Y' || sidecar?.glb_up_axis === 'Z') return sidecar.glb_up_axis;
  const raw = meta?.glb_up_axis;
  if (raw === 'Y' || raw === 'Z') return raw;
  if (
    sidecar?.up_axis === 'Z' ||
    meta?.up_axis === 'Z' ||
    meta?.spawn_profile === 'bim' ||
    sidecar?.spawn?.profile === 'bim'
  ) {
    return 'Y';
  }
  return null;
}

/** Resolve CAD up-axis from sidecar and/or spawn metadata. */
export function resolveModelUpAxis(
  sidecar: CadPlacementSidecar | null,
  meta?: Record<string, unknown> | null,
): 'Y' | 'Z' | null {
  if (sidecar?.up_axis === 'Y' || sidecar?.up_axis === 'Z') return sidecar.up_axis;
  const raw = meta?.up_axis;
  if (raw === 'Y' || raw === 'Z') return raw;
  if (meta?.spawn_profile === 'bim') return 'Z';
  return null;
}

/** Z-up CAD/BIM exports → Y-up Three.js scene (+Y gravity / grid). */
export function applyZUpModelCorrection(model: THREE.Object3D) {
  model.rotateX(-Math.PI / 2);
}

export function applySourceOrientation(
  model: THREE.Object3D,
  sidecar: CadPlacementSidecar | null,
  meta?: Record<string, unknown> | null,
) {
  const sourceUp = resolveModelUpAxis(sidecar, meta);
  const glbUp = resolveGlbUpAxis(sidecar, meta);
  // Only rotate when source is Z-up AND GLB was not already converted to Y-up in export.
  if (sourceUp === 'Z' && glbUp !== 'Y') {
    applyZUpModelCorrection(model);
  }
  if (sidecar?.placement?.rotation_euler_deg) {
    const [rx, ry, rz] = sidecar.placement.rotation_euler_deg.map((d) =>
      THREE.MathUtils.degToRad(Number(d) || 0),
    );
    model.rotation.x += rx;
    model.rotation.y += ry;
    model.rotation.z += rz;
  }
}

export function bottomCenterModel(model: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3();
  box.getCenter(center);
  model.position.set(-center.x, -box.min.y, -center.z);
}

/** After scale/orientation — snap entity root so world-space foot sits on y=0 grid. */
export function applyPlacementOffsetMm(
  root: THREE.Object3D,
  sidecar: CadPlacementSidecar | null,
  unitScale: number,
) {
  if (!sidecar?.placement?.position_mm) return;
  const [px, py, pz] = sidecar.placement.position_mm;
  const s = unitScale > 0 ? unitScale : 1;
  root.position.x += (Number(px) || 0) * s;
  root.position.y += (Number(py) || 0) * s;
  root.position.z += (Number(pz) || 0) * s;
}

export function buildSpatialSnapshot(
  entity: GameEntity,
  visual: THREE.Object3D,
  profile: CadSpawnProfile,
  meta: Record<string, unknown>,
): EntitySpatialSnapshot {
  const box = worldBoxFromObject(visual);
  const rot = eulerDegFromObject(visual);
  const units =
    profile === 'bim'
      ? meta.source_units === 'mm' || !meta.source_units
        ? 'm'
        : 'scene'
      : 'scene';
  return {
    units,
    world_bbox: boxToSnapshot(box),
    rotation_euler_deg: rot,
    entity_position: { ...entity.position },
    visual_scale: visual.scale.x,
    ground_y: box.min.y,
    spawn_profile: profile,
    up_axis: meta.up_axis === 'Y' ? 'Y' : meta.up_axis === 'Z' ? 'Z' : undefined,
    source_units: meta.source_units != null ? String(meta.source_units) : undefined,
  };
}
