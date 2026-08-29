import type { CatalogTheme } from './ThemePreviewCard';
import type { AgentHomeCmsConfig } from '../../types/agentHomeScene';
import { DEFAULT_AGENT_HOME_CMS } from '../../types/agentHomeScene';
import { applyAgentHomeCmsToDocument, dispatchAgentHomeScenePreview } from '../../lib/agentHomeSceneResolve';

export type AgentHomeTweakFields = {
  agentVignette: number;
  agentGrain: number;
  agentGlassOpacity: number;
  agentBackdropDawn: string;
  agentBackdropDay: string;
  agentBackdropDusk: string;
  agentBackdropNight: string;
  agentBackdropMinimal: string;
};

export const DEFAULT_AGENT_HOME_TWEAK_FIELDS: AgentHomeTweakFields = {
  agentVignette: 38,
  agentGrain: 3.5,
  agentGlassOpacity: 18,
  agentBackdropDawn: '',
  agentBackdropDay: '',
  agentBackdropDusk: '',
  agentBackdropNight: '',
  agentBackdropMinimal: '',
};

function parseComponents(theme: CatalogTheme | null): Record<string, unknown> {
  const parsed = (theme as { parsed?: { components_json?: unknown } })?.parsed;
  if (parsed?.components_json && typeof parsed.components_json === 'object') {
    return parsed.components_json as Record<string, unknown>;
  }
  try {
    const raw = (theme as { components_json?: string })?.components_json;
    if (typeof raw === 'string' && raw.trim()) return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return {};
}

function imageFromBackdrop(cms: AgentHomeCmsConfig, key: keyof AgentHomeCmsConfig['backdrops']): string {
  const bd = cms.backdrops?.[key];
  if (!bd) return '';
  if (bd.imageUrl?.trim()) return bd.imageUrl.trim();
  const img = bd.layers?.find((l) => l.type === 'image');
  return img?.type === 'image' ? img.url : '';
}

export function agentHomeFieldsFromTheme(theme: CatalogTheme | null): AgentHomeTweakFields {
  const components = parseComponents(theme);
  const cms = (components.agent_home as AgentHomeCmsConfig) || DEFAULT_AGENT_HOME_CMS;
  const atmosphere = cms.atmosphere ?? DEFAULT_AGENT_HOME_CMS.atmosphere!;
  const ui = cms.ui ?? DEFAULT_AGENT_HOME_CMS.ui!;
  return {
    agentVignette: Math.round((atmosphere.vignette ?? 0.38) * 100),
    agentGrain: Math.round((atmosphere.grain ?? 0.035) * 1000) / 10,
    agentGlassOpacity: Math.round((ui.glassOpacity ?? 0.18) * 100),
    agentBackdropDawn: imageFromBackdrop(cms, 'dawn'),
    agentBackdropDay: imageFromBackdrop(cms, 'day'),
    agentBackdropDusk: imageFromBackdrop(cms, 'dusk'),
    agentBackdropNight: imageFromBackdrop(cms, 'night'),
    agentBackdropMinimal: imageFromBackdrop(cms, 'minimal-dark'),
  };
}

function backdropFromUrl(url: string, fallback: AgentHomeCmsConfig['backdrops'][string]) {
  const trimmed = url.trim();
  if (!trimmed) return fallback;
  return {
    imageUrl: trimmed,
    layers: [{ type: 'image' as const, url: trimmed }],
  };
}

export function buildAgentHomeCmsFromFields(fields: AgentHomeTweakFields): AgentHomeCmsConfig {
  const defaults = DEFAULT_AGENT_HOME_CMS.backdrops!;
  return {
    version: 1,
    mode: 'fixed',
    fixedPreset: 'minimal-dark',
    atmosphere: {
      vignette: Math.min(1, Math.max(0, fields.agentVignette / 100)),
      grain: Math.min(1, Math.max(0, fields.agentGrain / 100)),
      glowAccent: 'var(--color-primary)',
    },
    ui: {
      greetingStyle: 'serif',
      glassOpacity: Math.min(1, Math.max(0, fields.agentGlassOpacity / 100)),
    },
    backdrops: {
      dawn: backdropFromUrl(fields.agentBackdropDawn, defaults.dawn!),
      day: backdropFromUrl(fields.agentBackdropDay, defaults.day!),
      dusk: backdropFromUrl(fields.agentBackdropDusk, defaults.dusk!),
      night: backdropFromUrl(fields.agentBackdropNight, defaults.night!),
      'minimal-dark': backdropFromUrl(fields.agentBackdropMinimal, defaults['minimal-dark']!),
    },
  };
}

export function applyAgentHomeFieldsLive(fields: AgentHomeTweakFields): void {
  const cms = buildAgentHomeCmsFromFields(fields);
  applyAgentHomeCmsToDocument(cms);
  dispatchAgentHomeScenePreview(cms);
}

export function agentHomePayloadFromFields(fields: AgentHomeTweakFields): { agent_home: AgentHomeCmsConfig } {
  return { agent_home: buildAgentHomeCmsFromFields(fields) };
}
