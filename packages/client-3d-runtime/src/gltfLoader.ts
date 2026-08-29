/**
 * Platform GLTFLoader — meshopt (skinned/animated) + optional Draco (static props).
 * Session-scoped URL cache: one fetch/parse per normalized GLB URL.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { normalizeGlbUrl } from './glbAssets';

let meshoptReady: Promise<void> | null = null;

const gltfCache = new Map<string, Promise<GLTF>>();

export function ensureMeshoptDecoderReady(): Promise<void> {
  if (!meshoptReady) {
    const decoder = MeshoptDecoder as { supported?: boolean; ready?: Promise<unknown> };
    meshoptReady =
      decoder.supported === false
        ? Promise.resolve()
        : (decoder.ready ?? Promise.resolve()).then(() => undefined);
  }
  return meshoptReady;
}

/** Primary loader factory for IAM GLBs (meshopt default; Draco when passed). */
export function createPlatformGltfLoader(dracoLoader?: DRACOLoader): GLTFLoader {
  const loader = new GLTFLoader();
  loader.setCrossOrigin('anonymous');

  const decoder = MeshoptDecoder as { supported?: boolean };
  if (decoder.supported !== false) {
    loader.setMeshoptDecoder(MeshoptDecoder);
  }

  if (dracoLoader) {
    loader.setDRACOLoader(dracoLoader);
  }

  return loader;
}

/** @deprecated Use createPlatformGltfLoader — alias for chess + legacy imports. */
export const createChessGltfLoader = createPlatformGltfLoader;

function normalizeAssetUrl(url: string): string {
  const trimmed = String(url ?? '').trim();
  if (!trimmed) return '';
  // Chess GLBs load direct from R2 custom domain (immutable CDN, meshopt-friendly).
  if (
    trimmed.includes('assets.inneranimalmedia.com/chess-pieces/') ||
    trimmed.includes('assets.inneranimalmedia.com/glb/chess/')
  ) {
    return trimmed;
  }
  return normalizeGlbUrl(trimmed) || trimmed;
}

/**
 * Load GLTF once per normalized URL per browser session (cached Promise).
 * Animation clips remain on the returned GLTF for new AnimationMixer instances.
 */
export async function loadCachedGltf(loader: GLTFLoader, url: string): Promise<GLTF> {
  await ensureMeshoptDecoderReady();
  const normalizedUrl = normalizeAssetUrl(url);
  if (!normalizedUrl) throw new Error('loadCachedGltf: empty URL');

  if (!gltfCache.has(normalizedUrl)) {
    const pending = loader.loadAsync(normalizedUrl).catch((err) => {
      gltfCache.delete(normalizedUrl);
      throw err;
    });
    gltfCache.set(normalizedUrl, pending);
  }

  return gltfCache.get(normalizedUrl)!;
}

/** Clone skinned/animated scenes without sharing skeleton state between instances. */
export function cloneGltfScene(gltf: GLTF): THREE.Object3D {
  return SkeletonUtils.clone(gltf.scene);
}

/** Clear session cache (e.g. after hot-swap of same path during dev). */
export function clearGltfCache(): void {
  gltfCache.clear();
}
