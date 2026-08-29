/**
 * MeauxChess piece materials and square overlay helpers.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getBoardSurfaceY } from './chessBoard';

let glassMaterial: THREE.MeshPhysicalMaterial | null = null;
let amberMaterial: THREE.MeshPhysicalMaterial | null = null;

export function setupChessEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envMap;
  pmrem.dispose();
  return envMap;
}

export function createGlassWhiteMaterial(): THREE.MeshPhysicalMaterial {
  if (glassMaterial) return glassMaterial;
  glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xccffee,
    transmission: 0.9,
    thickness: 0.8,
    roughness: 0.05,
    ior: 1.5,
    transparent: true,
    emissive: 0x00ffaa,
    emissiveIntensity: 0.2,
    envMapIntensity: 1.2,
  });
  return glassMaterial;
}

export function createAmberOrangeMaterial(): THREE.MeshPhysicalMaterial {
  if (amberMaterial) return amberMaterial;
  amberMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xe8821a,
    metalness: 0.1,
    roughness: 0.3,
    clearcoat: 0.8,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.0,
  });
  return amberMaterial;
}

export function applyChessPieceMaterials(root: THREE.Object3D, color: 'white' | 'black'): void {
  const mat = color === 'white' ? createGlassWhiteMaterial() : createAmberOrangeMaterial();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.material = mat;
      mesh.castShadow = true;
    }
  });
}

/** Baroque GLBs have authored materials baked in — white pieces are ivory
 * marble, black pieces are obsidian. Do not tint or override.
 * Just ensure castShadow and envMapIntensity are set.
 */
export function applyAuthoredChessPieceMaterials(
  root: THREE.Object3D,
  color: 'white' | 'black'
): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if ('envMapIntensity' in mat) {
        (mat as THREE.MeshStandardMaterial).envMapIntensity = 0.85;
      }
    }
  });
}

export function createSelectionOverlayMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0x4a9eff,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createValidMoveOverlayMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xc9a84c,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createLastMoveOverlayMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xc9a84c,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createHoverOverlayMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xf0e6d0,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createCheckOverlayMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xc0392b,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Full-square highlight plane slightly above the board surface. */
export function createSquareOverlay(
  x: number,
  z: number,
  material: THREE.Material,
): THREE.Mesh {
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.94), material);
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(x, getBoardSurfaceY() + 0.02, z);
  plane.renderOrder = 2;
  return plane;
}
