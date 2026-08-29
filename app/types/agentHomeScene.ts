// Scene config for /agent home background.
// Theme defaults: cms_themes.components_json.agent_home
// User overrides: agent_home_scene.scene_json (optional)

import { AGENT_EDITOR_PATH } from '../lib/agentRoutes';

export type SceneLayer =
  | { type: 'image'; url: string; blur?: number; parallax?: number }
  | { type: 'video'; url: string; muted: boolean }
  | { type: 'gradient'; stops: string[]; angle: number }
  | { type: 'preset'; id: ScenePresetId }
  | { type: 'webgl'; presetId: string; params: Record<string, number> };

export type ScenePresetId =
  | 'auto-time'
  | 'moonlit-sea'
  | 'dawn'
  | 'day'
  | 'dusk'
  | 'night'
  | 'aurora'
  | 'minimal-dark';

export interface AgentHomeBackdrop {
  layers: SceneLayer[];
  imageUrl?: string;
}

/** Flat theme canvas — scenic gradients live in optional backdrop images, not defaults. */
export const FLAT_CANVAS_BACKDROP: AgentHomeBackdrop = {
  layers: [
    {
      type: 'gradient',
      angle: 180,
      stops: ['var(--bg-canvas, #050b12) 0%', 'var(--bg-canvas, #050b12) 100%'],
    },
  ],
};

export interface AgentHomeCmsConfig {
  version: 1;
  mode?: 'auto-time' | 'fixed';
  fixedPreset?: ScenePresetId;
  /** Legacy single-stack layers (user overrides). */
  layers?: SceneLayer[];
  backdrops?: Partial<Record<ScenePresetId | 'minimal-dark', AgentHomeBackdrop>>;
  atmosphere?: {
    vignette?: number;
    grain?: number;
    glowAccent?: string;
  };
  ui?: {
    greetingStyle?: 'serif' | 'sans';
    glassOpacity?: number;
  };
}

/** Render-ready scene passed to AgentHomeScene (layers resolved for current day-part). */
export interface AgentHomeSceneConfig {
  version: 1;
  layers: SceneLayer[];
  atmosphere?: AgentHomeCmsConfig['atmosphere'];
  ui?: AgentHomeCmsConfig['ui'];
}

export const DEFAULT_AGENT_HOME_CMS: AgentHomeCmsConfig = {
  version: 1,
  mode: 'fixed',
  fixedPreset: 'minimal-dark',
  atmosphere: { vignette: 0.38, grain: 0.035, glowAccent: 'var(--color-primary)' },
  ui: { greetingStyle: 'serif', glassOpacity: 0.18 },
  backdrops: {
    dawn: FLAT_CANVAS_BACKDROP,
    day: FLAT_CANVAS_BACKDROP,
    dusk: FLAT_CANVAS_BACKDROP,
    night: FLAT_CANVAS_BACKDROP,
    'minimal-dark': FLAT_CANVAS_BACKDROP,
  },
};

export const DEFAULT_AGENT_HOME_SCENE: AgentHomeSceneConfig = {
  version: 1,
  layers: FLAT_CANVAS_BACKDROP.layers,
  atmosphere: DEFAULT_AGENT_HOME_CMS.atmosphere,
  ui: DEFAULT_AGENT_HOME_CMS.ui,
};

export type AgentModeId = 'code' | 'write' | 'create' | 'learn' | 'life';

export interface AgentModePill {
  id: AgentModeId;
  label: string;
  route?: string;
}

export const AGENT_MODE_PILLS: AgentModePill[] = [
  { id: 'code', label: 'Code', route: AGENT_EDITOR_PATH },
  { id: 'write', label: 'Write' },
  { id: 'create', label: 'Create' },
  { id: 'learn', label: 'Learn' },
  { id: 'life', label: 'Life stuff' },
];
