/**
 * Fresh chat session — no repo, connector, or Mac assumptions beyond workspace + identity.
 */
import { writeComposerSources } from '../../components/ChatAssistant/composer/composerSourcesStorage';
import { writeChatGithubContext } from '../../components/ChatAssistant/types';
import {
  SESSION_CONNECTORS_KEY,
  SESSION_PROJECT_ID_KEY,
  SESSION_PROJECT_NAME_KEY,
  SESSION_TOOLS_KEY,
} from './sessionStorageKeys';

export type FreshSessionResetOptions = {
  composerSourcesKey: string;
  githubContextStorageKey: string;
  onClearGithubState: () => void;
  onClearAttachments?: () => void;
  onClearProject?: () => void;
};

/** Reset client-side chat context for a new thread (ephemeral until user opts in). */
export function applyFreshChatSessionDefaults(opts: FreshSessionResetOptions): void {
  writeComposerSources(opts.composerSourcesKey, []);
  // Exec lane stays on dock SSOT — do not invent auto/remote here.
  try {
    writeChatGithubContext(opts.githubContextStorageKey, {
      repo: null,
      path: null,
      branch: 'main',
      content: null,
      content_truncated: false,
      content_sha: null,
    });
  } catch {
    /* ignore */
  }
  opts.onClearGithubState();
  opts.onClearAttachments?.();
  opts.onClearProject?.();
  try {
    sessionStorage.removeItem(SESSION_CONNECTORS_KEY);
    sessionStorage.removeItem(SESSION_TOOLS_KEY);
    sessionStorage.removeItem(SESSION_PROJECT_ID_KEY);
    sessionStorage.removeItem(SESSION_PROJECT_NAME_KEY);
  } catch {
    /* ignore */
  }
}

export function readSessionEnabledConnectors(): string[] {
  try {
    const raw = sessionStorage.getItem(SESSION_CONNECTORS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => String(x || '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function writeSessionEnabledConnectors(keys: string[]): void {
  try {
    sessionStorage.setItem(SESSION_CONNECTORS_KEY, JSON.stringify(keys.slice(0, 24)));
  } catch {
    /* ignore */
  }
}

export function toggleSessionConnector(providerKey: string, enabled: boolean): string[] {
  const set = new Set(readSessionEnabledConnectors());
  const pk = providerKey.trim();
  if (!pk) return [...set];
  if (enabled) set.add(pk);
  else {
    set.delete(pk);
    clearSessionToolsForProvider(pk);
  }
  const next = [...set];
  writeSessionEnabledConnectors(next);
  return next;
}

export type SessionToolsMap = Record<string, string[]>;

export function readSessionEnabledTools(): SessionToolsMap {
  try {
    const raw = sessionStorage.getItem(SESSION_TOOLS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: SessionToolsMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      out[k] = v.map((x) => String(x || '').trim()).filter(Boolean);
    }
    return out;
  } catch {
    return {};
  }
}

export function writeSessionEnabledTools(map: SessionToolsMap): void {
  try {
    sessionStorage.setItem(SESSION_TOOLS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function clearSessionToolsForProvider(providerKey: string): void {
  const pk = providerKey.trim();
  if (!pk) return;
  const map = readSessionEnabledTools();
  if (!map[pk]) return;
  delete map[pk];
  writeSessionEnabledTools(map);
}

/** Seed all tools when connector is enabled; preserves existing toggles if any. */
export function seedSessionToolsForProvider(providerKey: string, toolKeys: string[]): string[] {
  const pk = providerKey.trim();
  if (!pk) return [];
  const map = readSessionEnabledTools();
  if (map[pk]?.length) return map[pk];
  const keys = toolKeys.map((k) => k.trim()).filter(Boolean).slice(0, 120);
  map[pk] = keys;
  writeSessionEnabledTools(map);
  return keys;
}

export function toggleSessionTool(providerKey: string, toolKey: string, enabled: boolean): string[] {
  const pk = providerKey.trim();
  const tk = toolKey.trim();
  if (!pk || !tk) return readSessionEnabledTools()[pk] || [];
  const map = readSessionEnabledTools();
  const set = new Set(map[pk] || []);
  if (enabled) set.add(tk);
  else set.delete(tk);
  map[pk] = [...set];
  writeSessionEnabledTools(map);
  return map[pk];
}

export function isSessionToolEnabled(
  providerKey: string,
  toolKey: string,
  allToolKeys: string[],
): boolean {
  const pk = providerKey.trim();
  const tk = toolKey.trim();
  const map = readSessionEnabledTools();
  const list = map[pk];
  if (!list) {
    return readSessionEnabledConnectors().includes(pk) && allToolKeys.includes(tk);
  }
  return list.includes(tk);
}

/** Flat list of tool_key values enabled for this chat turn. */
export function flattenSessionEnabledTools(): string[] {
  const connectors = new Set(readSessionEnabledConnectors());
  const map = readSessionEnabledTools();
  const out = new Set<string>();
  for (const pk of connectors) {
    const keys = map[pk];
    if (keys?.length) {
      for (const k of keys) out.add(k);
    }
  }
  return [...out].slice(0, 200);
}

export type SessionProject = { id: string; name: string } | null;

export function readSessionProject(): SessionProject {
  try {
    const id = sessionStorage.getItem(SESSION_PROJECT_ID_KEY)?.trim() || '';
    if (!id) return null;
    const name = sessionStorage.getItem(SESSION_PROJECT_NAME_KEY)?.trim() || 'Project';
    return { id, name };
  } catch {
    return null;
  }
}

/**
 * UI label only (Context Hub chip). Does not put project_id on the next chat POST —
 * use setPendingProjectBind() for an explicit one-shot wire bind.
 */
export function writeSessionProject(
  project: SessionProject,
  _opts: { explicit?: boolean } = {},
): void {
  try {
    if (!project?.id) {
      sessionStorage.removeItem(SESSION_PROJECT_ID_KEY);
      sessionStorage.removeItem(SESSION_PROJECT_NAME_KEY);
      return;
    }
    sessionStorage.setItem(SESSION_PROJECT_ID_KEY, project.id);
    sessionStorage.setItem(SESSION_PROJECT_NAME_KEY, project.name || 'Project');
  } catch {
    /* ignore */
  }
}
