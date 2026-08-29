/**
 * UI preferences — workspace×user persisted prefs (CMS slug, default model).
 * Not part of agentsam_bootstrap authorization cache.
 */

import { jsonStable, parseJsonObject } from './contract.js';

const UI_PREFS_TABLE = 'agentsam_user_ui_preferences';
const LEGACY_TABLE = 'agentsam_bootstrap_legacy_v1';

/**
 * @param {unknown} env
 */
async function tableExists(env, name) {
  if (!env?.DB) return false;
  try {
    const row = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    )
      .bind(name)
      .first();
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

/**
 * @param {unknown} env
 * @param {{ workspaceId: string, userId: string }} p
 */
export async function loadUserUiPreferences(env, p) {
  const workspaceId = String(p.workspaceId || '').trim();
  const userId = String(p.userId || '').trim();
  if (!env?.DB || !workspaceId || !userId) return {};

  if (await tableExists(env, UI_PREFS_TABLE)) {
    try {
      const row = await env.DB.prepare(
        `SELECT ui_preferences_json FROM ${UI_PREFS_TABLE}
         WHERE workspace_id = ? AND user_id = ? LIMIT 1`,
      )
        .bind(workspaceId, userId)
        .first();
      if (row) return parseJsonObject(row.ui_preferences_json, {});
    } catch {
      /* fall through */
    }
  }

  if (await tableExists(env, LEGACY_TABLE)) {
    try {
      const row = await env.DB.prepare(
        `SELECT ui_preferences_json FROM ${LEGACY_TABLE}
         WHERE workspace_id = ? AND user_id = ? AND COALESCE(is_active, 1) = 1
         ORDER BY updated_at DESC LIMIT 1`,
      )
        .bind(workspaceId, userId)
        .first();
      if (row) return parseJsonObject(row.ui_preferences_json, {});
    } catch {
      /* ignore */
    }
  }

  try {
    const row = await env.DB.prepare(
      `SELECT ui_preferences_json FROM agentsam_bootstrap
       WHERE workspace_id = ? AND user_id = ? AND COALESCE(is_active, 1) = 1
       LIMIT 1`,
    )
      .bind(workspaceId, userId)
      .first();
    if (row?.ui_preferences_json != null) {
      return parseJsonObject(row.ui_preferences_json, {});
    }
  } catch {
    /* legacy column absent on v2 table */
  }

  return {};
}

/**
 * @param {unknown} env
 * @param {{ workspaceId: string, userId: string, preferences: Record<string, unknown> }} p
 */
export async function upsertUserUiPreferences(env, p) {
  const workspaceId = String(p.workspaceId || '').trim();
  const userId = String(p.userId || '').trim();
  if (!env?.DB || !workspaceId || !userId) return false;

  const json = jsonStable(p.preferences ?? {});

  if (await tableExists(env, UI_PREFS_TABLE)) {
  await env.DB.prepare(
      `INSERT INTO ${UI_PREFS_TABLE} (workspace_id, user_id, ui_preferences_json, updated_at_unix)
       VALUES (?, ?, ?, unixepoch())
       ON CONFLICT(workspace_id, user_id) DO UPDATE SET
         ui_preferences_json = excluded.ui_preferences_json,
         updated_at_unix = excluded.updated_at_unix`,
    )
      .bind(workspaceId, userId, json)
      .run();

  try {
    const { putSessionPrefsCache } = await import('../session-context/kv-cache.js');
    await putSessionPrefsCache(env, { workspaceId, userId, preferences: p.preferences ?? {} });
  } catch {
    /* non-fatal */
  }

  return true;
  }

  return false;
}
