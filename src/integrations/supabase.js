/**
 * Supabase PostgREST writers for Agent Sam observability tables (agentsam schema).
 */

import {
  supabaseHeaders,
  supabasePostJson,
  supabaseRestBase,
  supabaseServiceKey,
} from '../api/health/supabaseRest.js';
import { deriveProvider } from '../core/memory.js';

/**
 * Insert one row into agentsam.agentsam_routing_decisions (non-blocking callers should not await).
 * @param {any} env
 * @param {Record<string, unknown>} payload
 */
export async function writeSupabaseRoutingDecision(env, payload) {
  if (!payload || typeof payload !== 'object') return { ok: false };
  const row = { ...payload };
  if (row.provider == null || String(row.provider).trim() === '') {
    const mk = row.selected_model ?? row.model_key ?? row.selectedModel ?? row.modelKey;
    row.provider = deriveProvider(mk != null ? String(mk) : null) ?? 'unknown';
  }
  return supabasePostJson(env, '/rest/v1/agentsam_routing_decisions', row, 'agentsam');
}

/**
 * Patch routing outcome on an existing row keyed by run_group_id (chat agent run id).
 * @param {any} env
 * @param {string} runGroupId
 * @param {Record<string, unknown>} patch
 */
export async function patchSupabaseRoutingDecision(env, runGroupId, patch) {
  if (!runGroupId) return { ok: false };
  const base = supabaseRestBase(env);
  const key = supabaseServiceKey(env);
  if (!base || !key) return { ok: false, status: 0, data: null };
  const gid = encodeURIComponent(String(runGroupId));
  const url = `${base}/rest/v1/agentsam_routing_decisions?run_group_id=eq.${gid}`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        ...supabaseHeaders(env, 'agentsam'),
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(patch),
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
