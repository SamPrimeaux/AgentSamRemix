import type { AgentDayPart } from './agentDayPart';
import { scenePresetForDayPart } from './agentDayPart';
import type { AgentHomeCmsConfig, ScenePresetId } from '../types/agentHomeScene';
import { DEFAULT_AGENT_HOME_CMS } from '../types/agentHomeScene';
import { dispatchAgentHomeScenePreview } from './agentHomeSceneResolve';

export type ImageDraftDayPart = 'dawn' | 'day' | 'dusk' | 'night' | 'minimal-dark';

export function dayPartToBackdropKey(dayPart: ImageDraftDayPart): ScenePresetId | 'minimal-dark' {
  if (dayPart === 'minimal-dark') return 'minimal-dark';
  if (dayPart === 'dawn' || dayPart === 'day' || dayPart === 'dusk' || dayPart === 'night') {
    return dayPart;
  }
  return scenePresetForDayPart(dayPart as AgentDayPart) as ScenePresetId;
}

/** Browser-only preview — does not write cms_themes or agent_home_scene. */
export function previewAgentHomeBackdropImage(imageUrl: string, dayPart: ImageDraftDayPart = 'dusk'): void {
  const url = String(imageUrl || '').trim();
  if (!url) return;
  const key = dayPartToBackdropKey(dayPart);
  const backdrops = { ...(DEFAULT_AGENT_HOME_CMS.backdrops || {}) };
  backdrops[key] = {
    layers: [{ type: 'image', url }],
  };
  const cms: AgentHomeCmsConfig = {
    ...DEFAULT_AGENT_HOME_CMS,
    backdrops,
  };
  dispatchAgentHomeScenePreview(cms);
}

export type CommitImageDraftResponse = {
  ok?: boolean;
  status?: string;
  url?: string;
  public_url?: string;
  asset_id?: string;
  image_id?: string;
  generation_id?: string;
  error?: string;
};

export async function saveImageDraft(
  generationId: string,
  opts: {
    workspaceId?: string | null;
    label?: string;
    category?: string;
    tags?: string[];
    project_id?: string | null;
    register_cms_asset?: boolean;
  } = {},
): Promise<CommitImageDraftResponse> {
  const res = await fetch('/api/images/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      generation_id: generationId,
      workspace_id: opts.workspaceId || undefined,
      label: opts.label,
      category: opts.category ?? 'agent_backdrops',
      tags: opts.tags,
      project_id: opts.project_id || undefined,
      register_cms_asset: opts.register_cms_asset ?? true,
    }),
  });
  const json = (await res.json().catch(() => null)) as CommitImageDraftResponse | null;
  if (!res.ok) {
    throw new Error(json?.error || 'Failed to save image to library');
  }
  return json || {};
}

/** @deprecated use saveImageDraft — removed soon */
export const commitImageDraft = saveImageDraft;

export async function discardImageDraft(generationId: string): Promise<void> {
  const res = await fetch('/api/images/discard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ generation_id: generationId }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(json?.error || 'Failed to discard draft');
  }
}

export type RateImageDraftResponse = {
  ok?: boolean;
  generation_id?: string;
  rating?: 1 | -1;
  content_tier?: string | null;
  model?: string | null;
  feedback_id?: string;
  thompson_updated?: boolean;
  error?: string;
};

export async function rateImageDraft(
  generationId: string,
  rating: 1 | -1,
  workspaceId?: string | null,
): Promise<RateImageDraftResponse> {
  const res = await fetch('/api/images/rate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      generation_id: generationId,
      rating,
      workspace_id: workspaceId || undefined,
    }),
  });
  const json = (await res.json().catch(() => null)) as RateImageDraftResponse | null;
  if (!res.ok) {
    throw new Error(json?.error || 'Failed to rate image');
  }
  return json || { ok: true, rating };
}

export async function applyAgentHomeBackdropToTheme(
  workspaceId: string,
  imageUrl: string,
  dayPart: ImageDraftDayPart,
  themeId?: string | null,
): Promise<void> {
  const url = String(imageUrl || '').trim();
  if (!url || !workspaceId.trim()) throw new Error('workspace and image URL required');
  const key = dayPartToBackdropKey(dayPart);

  let resolvedThemeId = themeId?.trim() || '';
  if (!resolvedThemeId) {
    const activeRes = await fetch('/api/themes/active', { credentials: 'include' });
    const activeJson = (await activeRes.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!activeRes.ok) {
      throw new Error(activeJson?.error || 'Could not load active theme');
    }
    resolvedThemeId = String(activeJson?.id || '').trim();
  }
  if (!resolvedThemeId) throw new Error('Active theme not found');

  const agentHome: AgentHomeCmsConfig = {
    version: 1,
    mode: 'auto-time',
    backdrops: {
      [key]: { layers: [{ type: 'image', url }] },
    },
  };

  const res = await fetch('/api/themes/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      theme_id: resolvedThemeId,
      agent_home: agentHome,
      apply_to_user: true,
      preview_live: true,
    }),
  });
  const json = (await res.json().catch(() => null)) as {
    error?: string;
    active_theme?: import('../src/applyCmsTheme').CmsActiveThemePayload;
  } | null;
  if (!res.ok) {
    throw new Error(json?.error || 'Failed to apply backdrop to theme');
  }
  if (json?.active_theme) {
    const { applyCmsThemeToDocument } = await import('../src/applyCmsTheme');
    applyCmsThemeToDocument(json.active_theme);
  }
}
