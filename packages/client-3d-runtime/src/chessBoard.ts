/**
 * Procedural chess board — runtime Three.js (fallback when no board GLB).
 */
import * as THREE from 'three';

let boardSurfaceY = 0.05;

export function getBoardSurfaceY(): number {
  return boardSurfaceY;
}

export function setBoardSurfaceY(y: number): void {
  boardSurfaceY = Number.isFinite(y) ? y : boardSurfaceY;
}

/** @deprecated use getBoardSurfaceY() */
export const BOARD_SURFACE_Y = boardSurfaceY;

/** Rank 1 near player (+Z), rank 8 toward far side (-Z). */
export function rankToZ(rank: number): number {
  return 4.5 - rank;
}

export function zToRank(z: number): number {
  return Math.round(4.5 - z);
}

export function createChessPickLayer(): THREE.Group {
  const board = new THREE.Group();
  board.name = 'chess_pick_layer';
  const squares: THREE.Mesh[] = [];
  const mat = new THREE.MeshBasicMaterial({
    visible: false,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const files = 'abcdefgh';
  for (let row = 0; row < 8; row++) {
    const rank = row + 1;
    for (let col = 0; col < 8; col++) {
      const square = new THREE.Mesh(new THREE.BoxGeometry(1, 0.04, 1), mat);
      square.position.set(col - 3.5, 0, rankToZ(rank));
      square.userData = { square: `${files[col]}${rank}` };
      board.add(square);
      squares.push(square);
    }
  }
  board.userData.squareMeshes = squares;
  return board;
}

export function repositionPickLayer(pickLayer: THREE.Group, surfaceY: number): void {
  pickLayer.position.y = surfaceY;
  pickLayer.children.forEach((c) => {
    (c as THREE.Mesh).position.y = 0.05;
  });
}

export function createChessBoard(): THREE.Group {
  const board = new THREE.Group();
  board.name = 'chess_board';

  const lightMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xe8d5b0,
    roughness: 0.4,
    metalness: 0.0,
    clearcoat: 0.3,
  });

  const darkMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x4a2f1a,
    roughness: 0.4,
    metalness: 0.0,
    clearcoat: 0.3,
  });

  const squares: THREE.Mesh[] = [];
  for (let row = 0; row < 8; row++) {
    const rank = row + 1;
    for (let col = 0; col < 8; col++) {
      const geo = new THREE.BoxGeometry(1, 0.1, 1);
      const mat = (row + col) % 2 === 0 ? lightMaterial : darkMaterial;
      const square = new THREE.Mesh(geo, mat);
      square.position.set(col - 3.5, 0, rankToZ(rank));
      square.receiveShadow = true;
      square.userData = { squareCol: col, squareRow: row, isBoardSquare: true };
      board.add(square);
      squares.push(square);
    }
  }

  const frameMat = new THREE.MeshPhysicalMaterial({
    color: 0x3b1f0e,
    roughness: 0.5,
    clearcoat: 0.5,
  });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.3, 10.2), frameMat);
  frame.position.set(0, -0.12, 0);
  frame.receiveShadow = true;
  frame.castShadow = true;
  board.add(frame);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 13),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.28;
  board.add(shadow);

  addBoardCoordinates(board);
  board.userData.squareMeshes = squares;
  return board;
}

function addBoardCoordinates(board: THREE.Group): void {
  const files = 'abcdefgh';
  for (let col = 0; col < 8; col++) {
    board.add(makeCoordLabel(files[col], col - 3.5, -4.55));
  }
  for (let row = 0; row < 8; row++) {
    board.add(makeCoordLabel(String(row + 1), -4.55, rankToZ(row + 1)));
  }
}

function makeCoordLabel(text: string, x: number, z: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '500 28px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 32);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, 0.18, z);
  sprite.scale.set(0.38, 0.38, 0.38);
  return sprite;
}

export function boardPointToSquare(x: number, z: number): string | null {
  const files = 'abcdefgh';
  const col = Math.round(x + 3.5);
  const rank = zToRank(z);
  if (col < 0 || col > 7 || rank < 1 || rank > 8) return null;
  return `${files[col]}${rank}`;
}

export function squareToBoardXZ(square: string): { x: number; z: number } | null {
  const files = 'abcdefgh';
  const s = String(square || '').trim().toLowerCase();
  if (s.length !== 2) return null;
  const col = files.indexOf(s[0]);
  const rank = parseInt(s[1], 10);
  if (col < 0 || rank < 1 || rank > 8) return null;
  return { x: col - 3.5, z: rankToZ(rank) };
}
