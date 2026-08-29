/** Shared scene environment + material types for Design Studio panels. */

export type StudioSceneEnvConfig = {
  ambientIntensity: number;
  castShadows: boolean;
  fogDensity: number;
  sunHeight: number;
  sunPower: number;
  exposure: number;
};

export type StudioSceneEnvPatch = Partial<StudioSceneEnvConfig> & {
  fogEnabled?: boolean;
  sunColor?: string;
};

export type EntityMaterialPatch = {
  color?: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
  wireframe?: boolean;
  emissive?: boolean;
};

export const DEFAULT_STUDIO_SCENE_ENV: StudioSceneEnvConfig = {
  ambientIntensity: 1.5,
  castShadows: true,
  fogDensity: 0,
  sunHeight: 45,
  sunPower: 3,
  exposure: 1.5,
};

export const STUDIO_WORLD_PRESETS: {
  label: string;
  bg: string;
  ambientIntensity: number;
  sunPower: number;
  exposure: number;
  fogDensity: number;
}[] = [
  { label: 'Exterior Day', bg: '#c8d8f0', ambientIntensity: 1.8, sunPower: 2.8, exposure: 1.35, fogDensity: 0.002 },
  { label: 'Interior Studio', bg: '#1a1c21', ambientIntensity: 1.4, sunPower: 2.2, exposure: 1.2, fogDensity: 0 },
  { label: 'Golden Hour', bg: '#2a1810', ambientIntensity: 1.2, sunPower: 3.5, exposure: 1.1, fogDensity: 0.008 },
  { label: 'Night Sky', bg: '#050810', ambientIntensity: 0.6, sunPower: 0.4, exposure: 0.85, fogDensity: 0.012 },
  { label: 'Product White', bg: '#e8e8ec', ambientIntensity: 2.2, sunPower: 1.8, exposure: 1.6, fogDensity: 0 },
];

export const STUDIO_CANVAS_PRESETS = [
  { label: 'Studio', bg: '#1a1c21' },
  { label: 'Void', bg: '#000000' },
  { label: 'Day', bg: '#c8d8f0' },
  { label: 'Dusk', bg: '#1a0f2e' },
  { label: 'Space', bg: '#050810' },
] as const;
