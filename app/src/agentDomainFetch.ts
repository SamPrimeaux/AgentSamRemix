/**
 * L2 agent-domain fetches — policy, models, default model.
 * Not loaded by dashboard bootstrap; invalidate on workspace switch.
 */

import type { ChatModelRow } from '../components/ChatAssistant/types';

const policyCacheByWorkspace: Record<string, Record<string, unknown> | null> = {};
let modelsCache: ChatModelRow[] | undefined;
/** Bumps on invalidate so stale in-flight responses cannot poison the cache. */
let modelsFetchGeneration = 0;
let modelsInflight: Promise<ChatModelRow[]> | null = null;
let modelsInflightGeneration = 0;
let defaultModelCache: string | null | undefined;
let defaultModelInflight: Promise<string | null> | null = null;

function debugL2(label: string, detail?: string) {
  try {
    if (localStorage.getItem('IAM_DEBUG_L2') !== '1') return;
    console.info(`[IAM L2] ${label}${detail ? `: ${detail}` : ''}`);
  } catch {
    /* ignore */
  }
}

function mapModelRow(raw: Record<string, unknown>): ChatModelRow {
  return {
    id: String(raw.id ?? raw.model_key ?? ''),
    name: String(raw.name ?? raw.display_name ?? raw.model_key ?? ''),
    provider: String(raw.provider ?? ''),
    model_key: String(raw.model_key ?? ''),
    api_platform: String(raw.api_platform ?? ''),
    picker_group:
      raw.picker_group != null && String(raw.picker_group).trim()
        ? String(raw.picker_group).trim()
        : '',
    size_class: raw.size_class != null ? String(raw.size_class) : '',
    input_rate_per_mtok: raw.input_rate_per_mtok != null ? Number(raw.input_rate_per_mtok) : null,
    output_rate_per_mtok: raw.output_rate_per_mtok != null ? Number(raw.output_rate_per_mtok) : null,
    byok_configured: raw.byok_configured === true,
    byok_masked: raw.byok_masked != null ? String(raw.byok_masked) : null,
    billing_key_source:
      raw.billing_key_source != null ? String(raw.billing_key_source) : undefined,
  };
}

/** Sync snapshot for React state init — survives ChatAssistant remounts. */
export function getCachedAgentModels(): ChatModelRow[] {
  return modelsCache && modelsCache.length > 0 ? modelsCache : [];
}

/** Clear L2 caches — call on workspace switch (all) or single workspace policy. */
export function invalidateAgentDomainCache(workspaceId?: string | null) {
  // Always drop models/default caches. Sticky empty [] was freezing the picker on Auto-only
  // across workspace switches when only policy was cleared.
  modelsCache = undefined;
  modelsFetchGeneration += 1;
  modelsInflight = null;
  defaultModelCache = undefined;
  defaultModelInflight = null;
  if (workspaceId?.trim()) {
    delete policyCacheByWorkspace[workspaceId.trim()];
    debugL2('invalidate policy + models cache', workspaceId.trim());
  } else {
    for (const k of Object.keys(policyCacheByWorkspace)) delete policyCacheByWorkspace[k];
    debugL2('invalidate all L2 caches');
  }
}

export async function fetchAgentPolicy(
  workspaceId: string,
): Promise<Record<string, unknown> | null> {
  const ws = workspaceId.trim();
  if (!ws) return null;

  if (Object.prototype.hasOwnProperty.call(policyCacheByWorkspace, ws)) {
    return policyCacheByWorkspace[ws];
  }

  debugL2('fetch /api/agent/policy', ws);
  try {
    const r = await fetch('/api/agent/policy', { credentials: 'same-origin' });
    if (!r.ok) {
      policyCacheByWorkspace[ws] = null;
      return null;
    }
    const data = (await r.json()) as { agent_policy?: Record<string, unknown> | null };
    const next = data?.agent_policy ?? null;
    policyCacheByWorkspace[ws] = next;
    return next;
  } catch {
    policyCacheByWorkspace[ws] = null;
    return null;
  }
}

/**
 * @param {{ force?: boolean }} [opts] force=true bypasses warm cache (catalog flips like show_in_picker).
 */
export async function fetchAgentModels(opts: { force?: boolean } = {}): Promise<ChatModelRow[]> {
  // Only cache non-empty catalogs. Empty/error must NOT stick — that freezes Auto-only.
  if (!opts.force && modelsCache !== undefined && modelsCache.length > 0) return modelsCache;
  if (!opts.force && modelsInflight) return modelsInflight;
  if (opts.force) {
    modelsCache = undefined;
    modelsFetchGeneration += 1;
    modelsInflight = null;
  }

  const gen = modelsFetchGeneration;
  modelsInflightGeneration = gen;
  debugL2('fetch /api/agent/models', `gen=${gen}`);
  modelsInflight = fetch('/api/agent/models?show_in_picker=1', { credentials: 'same-origin' })
    .then(async (r) => {
      if (!r.ok) {
        debugL2('models fetch non-ok', String(r.status));
        // Do not cache failures.
        if (gen === modelsFetchGeneration) modelsCache = undefined;
        throw new Error(`models_http_${r.status}`);
      }
      const data = await r.json();
      const rawList = Array.isArray(data)
        ? data
        : Array.isArray((data as { models?: unknown })?.models)
          ? (data as { models: Record<string, unknown>[] }).models
          : [];
      const rows = (rawList as Record<string, unknown>[]).map(mapModelRow).filter((m) => m.model_key);
      // Stale after invalidate — return rows to the waiter but do not write cache.
      if (gen !== modelsFetchGeneration) {
        debugL2('models fetch stale gen — skip cache write', `gen=${gen} now=${modelsFetchGeneration}`);
        return rows;
      }
      if (rows.length > 0) {
        modelsCache = rows;
      } else {
        modelsCache = undefined;
        debugL2('models fetch empty body — not caching');
      }
      return rows;
    })
    .catch((err) => {
      debugL2('models fetch failed', err?.message ? String(err.message) : 'error');
      if (gen === modelsFetchGeneration) modelsCache = undefined;
      throw err instanceof Error ? err : new Error('models_fetch_failed');
    })
    .finally(() => {
      // Only clear the slot if we still own it (do not null a newer inflight).
      if (modelsInflightGeneration === gen) {
        modelsInflight = null;
      }
    });

  return modelsInflight;
}

export async function fetchAgentDefaultModel(): Promise<string | null> {
  if (defaultModelCache !== undefined) return defaultModelCache;
  if (defaultModelInflight) return defaultModelInflight;

  debugL2('fetch /api/settings/default-model');
  defaultModelInflight = fetch('/api/settings/default-model', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : {}))
    .then((d: { default_model?: string | null }) => {
      const dm =
        typeof d.default_model === 'string' && d.default_model.trim()
          ? d.default_model.trim()
          : null;
      defaultModelCache = dm;
      return dm;
    })
    .catch(() => {
      defaultModelCache = null;
      return null;
    })
    .finally(() => {
      defaultModelInflight = null;
    });

  return defaultModelInflight;
}
