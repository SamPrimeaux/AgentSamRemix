
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export enum ProjectType {
  CHESS = 'MEAAUX_GAMES',
  CAD = 'MEAUX_CAD',
  SANDBOX = 'SANDBOX',
  CITY = 'PROC_CITY',
  FLY = 'FLY_SCENE',
}

export enum ArtStyle {
  CYBERPUNK = 'CYBERPUNK',
  BRUTALIST = 'BRUTALIST',
  ORGANIC = 'ORGANIC',
  LOW_POLY = 'LOW_POLY'
}

export enum CADTool {
  NONE = 'NONE',
  VOXEL = 'VOXEL',
  PAINT = 'PAINT',
  LINE = 'LINE',
  RECTANGLE = 'RECTANGLE',
  CIRCLE = 'CIRCLE',
  CUBE = 'CUBE',
  SPHERE = 'SPHERE',
  CONE = 'CONE'
}

export enum CADPlane {
  XZ = 'XZ', // Ground
  XY = 'XY', // Front
  YZ = 'YZ'  // Side
}

export enum AppState {
  EDITING = 'EDITING',
  PLAYING = 'PLAYING',
  GENERATING = 'GENERATING',
  PLANNING = 'PLANNING'
}

export interface VoxelData {
  x: number;
  y: number;
  z: number;
  color: number;
}

export interface EntityBehavior {
  type: 'static' | 'hover' | 'rotate' | 'patrol' | 'chess_piece' | 'dynamic';
  speed?: number;
  mass?: number;
  restitution?: number;
  friction?: number;
  metadata?: any;
}

export interface GameEntity {
  id: string;
  name: string;
  type: 'player' | 'npc' | 'prop' | 'hazard' | 'piece';
  voxels?: VoxelData[];
  modelUrl?: string;
  scale?: number;
  rotation?: { x: number; y: number; z: number };
  position: { x: number, y: number, z: number };
  behavior: EntityBehavior;
}

export interface SceneConfig {
  ambientIntensity: number;
  sunColor: string;
  castShadows: boolean;
  showPhysicsDebug: boolean;
}

export interface GenerationConfig {
  style: ArtStyle;
  density: number; // 1-10 scale
  usePhysics: boolean;
  cadTool: CADTool;
  cadPlane: CADPlane;
  extrusion: number;
}

export interface CustomAsset {
  id: string;
  name: string;
  url: string;
  scale?: number;
}

export interface ProjectConfig {
  id: string;
  name: string;
  type: ProjectType;
  lastModified: number;
}

import type { FileKind } from './src/lib/fileKind';

/** Where Monaco Save should persist — stamped on open; missing → fail-loud Save. */
export type ActiveFileSourceType =
  | 'local'
  | 'github'
  | 'r2'
  | 'drive'
  | 'plan_d1'
  | 'mcp_tool'
  | 'ephemeral';

/** Open file in Monaco — local handle, R2, GitHub, or Drive metadata */
export type ActiveFile = {
  name: string;
  content: string;
  originalContent?: string;
  /** Persist target for Save — inferred on open when omitted */
  source_type?: ActiveFileSourceType;
  /** Classified media/text kind — non-text opens FilePreview instead of Monaco body */
  fileKind?: FileKind;
  /** Blob URL for local binary preview (revoke on tab close) */
  localObjectUrl?: string;
  /** Relative path within the connected native folder (for lightweight chat context). */
  workspacePath?: string;
  handle?: FileSystemFileHandle;
  r2Key?: string;
  r2Bucket?: string;
  githubPath?: string;
  githubRepo?: string;
  githubSha?: string;
  /** Branch used for GitHub Contents API (list/get); save/delete should send the same branch. */
  githubBranch?: string;
  driveFileId?: string;
  /** R2 /api/r2/file: image preview via /api/r2/get */
  isImage?: boolean;
  isBinary?: boolean;
  previewUrl?: string;
  contentType?: string;
  size?: number;
  binaryMessage?: string;
  /** Full byte/char length when content was truncated for Monaco */
  originalSize?: number;
};

// ── AgentSamEngineerEngine types ───────────────────────────────────────────

export type CityStreetPattern = 'grid' | 'organic' | 'radial' | 'canal';
export type CityStyle = 'modernGlass' | 'european' | 'tokyoDense' | 'cyberpunk' | 'brutalist' | 'desert';
export type CityTerrainStyle = 'flatlands' | 'coastline' | 'hills' | 'delta';
export type CityViewPreset = 'orbit' | 'overhead' | 'isometric' | 'street' | 'cinematic';
export type CityDistrictPreset = 'custom' | 'downtown' | 'suburbia' | 'industrialBelt' | 'mixedUse';

export interface CityConfig {
  citySize: number;
  density: number;
  blockSize: number;
  streetPattern: CityStreetPattern;
  districtPreset: CityDistrictPreset;
  commercial: number;
  residential: number;
  industrial: number;
  averageHeight: number;
  heightVariance: number;
  landmarkChance: number;
  cityStyle: CityStyle;
  riverProbability: number;
  parksPercentage: number;
  terrainRoughness: number;
  terrainStyle: CityTerrainStyle;
  exposure: number;
  ambientFill: number;
  sunPower: number;
  sunHeight: number;
  viewPreset: CityViewPreset;
  seed: number;
}

export const DEFAULT_CITY_CONFIG: CityConfig = {
  citySize: 18, density: 70, blockSize: 12, streetPattern: 'grid',
  districtPreset: 'custom', commercial: 38, residential: 44, industrial: 18,
  averageHeight: 30, heightVariance: 46, landmarkChance: 8,
  cityStyle: 'modernGlass', riverProbability: 38, parksPercentage: 14,
  terrainRoughness: 28, terrainStyle: 'coastline',
  exposure: 122, ambientFill: 86, sunPower: 136, sunHeight: 96,
  viewPreset: 'orbit', seed: 4172,
};

export type FlyMode = 'autopilot' | 'manual';

export interface FlyConfig {
  mode: FlyMode;
  viewpoint: number;
  fov: number;
}

export const DEFAULT_FLY_CONFIG: FlyConfig = {
  mode: 'autopilot', viewpoint: 0, fov: 48,
};

export interface FlyHud {
  mode: string;
  altitude: number;
  heading: string;
}

export interface CityStats {
  structures: number;
  parks: number;
  styleName: string;
}
