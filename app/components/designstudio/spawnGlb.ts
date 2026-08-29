import {
  fetchPlacementSidecarForGlb,
  spawnMetadataFromSidecar,
} from '../../lib/cadPlacement';
import { normalizeGlbUrl } from '@inneranimalmedia/client-3d-runtime/assets';
import type { GameEntity } from '../../types';

type SpawnEngine = {
  spawnEntity: (entity: GameEntity) => Promise<void> | void;
};

export type SpawnGlbOpts = {
  url: string;
  name?: string;
  scale?: number;
  normalize?: boolean;
  position?: { x: number; y: number; z: number };
  metadata?: Record<string, unknown>;
};

export async function spawnGlbInEngine(
  engine: SpawnEngine | null | undefined,
  opts: SpawnGlbOpts,
): Promise<boolean> {
  if (!engine) return false;
  const raw = opts.normalize !== false ? normalizeGlbUrl(opts.url) : opts.url;
  if (!raw?.trim()) {
    console.warn('[spawnGlb] empty url');
    return false;
  }
  try {
    const sidecar = await fetchPlacementSidecarForGlb(raw);
    const sidecarMeta = sidecar ? spawnMetadataFromSidecar(sidecar) : undefined;
    const metadata = {
      ...(sidecarMeta || {}),
      ...(opts.metadata || {}),
    };
    await engine.spawnEntity({
      id: `glb_${Date.now()}`,
      name: opts.name || 'CAD Model',
      type: 'prop',
      modelUrl: raw,
      scale: opts.scale ?? 1,
      position: opts.position ?? { x: 0, y: 1, z: 0 },
      behavior: {
        type: 'static',
        metadata: Object.keys(metadata).length ? metadata : undefined,
      },
    });
    return true;
  } catch (e) {
    console.warn('[spawnGlb] spawn failed', e);
    return false;
  }
}
