import type { AgentDayPart } from './agentDayPart';
import { scenePresetForDayPart } from './agentDayPart';
import type { AgentHomeCmsConfig, AgentHomeSceneConfig } from '../types/agentHomeScene';
import { DEFAULT_AGENT_HOME_CMS } from '../types/agentHomeScene';

export function resolveAgentHomeDisplayScene(
  cms: AgentHomeCmsConfig | null | undefined,
  dayPart: AgentDayPart,
): AgentHomeSceneConfig {
  const cfg = cms?.version === 1 ? cms : DEFAULT_AGENT_HOME_CMS;
  const atmosphere = cfg.atmosphere ?? DEFAULT_AGENT_HOME_CMS.atmosphere;
  const ui = cfg.ui ?? DEFAULT_AGENT_HOME_CMS.ui;

  let presetKey = scenePresetForDayPart(dayPart);
  if (cfg.mode === 'fixed' && cfg.fixedPreset) {
    const fixed = cfg.fixedPreset;
    if (fixed === 'moonlit-sea' || fixed === 'night') presetKey = 'night';
    else presetKey = fixed;
  }

  const backdrops = cfg.backdrops ?? DEFAULT_AGENT_HOME_CMS.backdrops;
  const backdrop = backdrops[presetKey] ?? backdrops.night ?? DEFAULT_AGENT_HOME_CMS.backdrops.night;
  let layers = backdrop?.layers ?? DEFAULT_AGENT_HOME_CMS.backdrops.night.layers;

  if (cfg.layers?.length && !cfg.backdrops) {
    layers = cfg.layers;
  }

  return {
    version: 1,
    layers: layers.map((l) => ({ ...l })),
    atmosphere: { ...atmosphere },
    ui: { ...ui },
  };
}

export function applyDayPartToScene(
  cms: AgentHomeCmsConfig,
  dayPart: AgentDayPart,
  _sceneSource: 'default' | 'user' | 'workspace',
): AgentHomeSceneConfig {
  return resolveAgentHomeDisplayScene(cms, dayPart);
}

export function applyAgentHomeCmsToDocument(cms: AgentHomeCmsConfig | null | undefined): void {
  const cfg = cms?.version === 1 ? cms : DEFAULT_AGENT_HOME_CMS;
  const root = document.documentElement;
  const atmosphere = cfg.atmosphere ?? DEFAULT_AGENT_HOME_CMS.atmosphere;
  const ui = cfg.ui ?? DEFAULT_AGENT_HOME_CMS.ui;
  root.style.setProperty('--agent-vignette', String(atmosphere.vignette ?? 0.38));
  root.style.setProperty('--agent-grain', String(atmosphere.grain ?? 0.035));
  root.style.setProperty('--agent-glass-opacity', String(ui.glassOpacity ?? 0.18));
  if (atmosphere.glowAccent) {
    root.style.setProperty('--agent-glow-accent', atmosphere.glowAccent);
  }
}

export const IAM_AGENT_HOME_SCENE_CHANGED = 'iam:agent-home-scene-changed';

export function dispatchAgentHomeScenePreview(cms: AgentHomeCmsConfig): void {
  applyAgentHomeCmsToDocument(cms);
  window.dispatchEvent(new CustomEvent(IAM_AGENT_HOME_SCENE_CHANGED, { detail: { cms } }));
}
