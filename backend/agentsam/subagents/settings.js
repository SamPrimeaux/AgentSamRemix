/** Agent Sam custom-subagent settings service over the canonical profile store. */
import {
  createSubagentProfile,
  deleteSubagentProfile,
  listSubagentProfilesForSettings,
  updateSubagentProfile,
} from './profile-store.js';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

function fail(kind, error) {
  return { ok: false, kind, error };
}

async function validateToolProfile(env, input) {
  if (!Object.prototype.hasOwnProperty.call(input || {}, 'tool_profile_key')) return null;
  const key = trim(input.tool_profile_key).slice(0, 128);
  if (!key) return null;
  const row = await env?.DB?.prepare(
    `SELECT profile_key FROM agentsam_tool_profiles
     WHERE profile_key = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
  )
    .bind(key)
    .first()
    .catch(() => null);
  return row?.profile_key ? null : `unknown tool_profile_key: ${key}`;
}

function mapStoreError(error) {
  if (error === 'id required' || error === 'user_id required' || error === 'display_name required' || error === 'No fields to update' || String(error).startsWith('access_mode must')) return 'validation';
  if (error === 'not_found' || error === 'delete_noop') return 'not_found';
  if (error === 'forbidden' || error === 'platform_profile_forbidden') return 'forbidden';
  if (error === 'slug_already_exists') return 'conflict';
  if (error === 'DB not configured') return 'unavailable';
  return 'internal';
}

export async function listSubagentsForSettings(env, scope) {
  if (!env?.DB) return { ok: true, body: { subagents: [] } };
  const userId = trim(scope?.userId);
  if (!userId) return fail('unauthenticated', 'user required');
  const workspaceId = trim(scope?.workspaceId);
  const rows = await listSubagentProfilesForSettings(env, { ...scope, userId, workspaceId });
  return { ok: true, body: { subagents: rows, workspace_id: workspaceId || null } };
}

export async function createSubagentForSettings(env, scope, input = {}) {
  if (!env?.DB) return fail('unavailable', 'DB not configured');
  const userId = trim(scope?.userId);
  if (!userId) return fail('unauthenticated', 'user required');
  const toolProfileError = await validateToolProfile(env, input);
  if (toolProfileError) return fail('validation', toolProfileError);
  const out = await createSubagentProfile(env, scope, input);
  if (!out?.ok) {
    const kind = mapStoreError(out?.error);
    const message = out?.error === 'slug_already_exists'
      ? 'A subagent with this slug already exists in this workspace'
      : out?.error || 'subagent_create_failed';
    return fail(kind, message);
  }
  return { ok: true, body: { ok: true, id: out.id, subagent: out.subagent } };
}

export async function patchSubagentForSettings(env, scope, id, input = {}) {
  if (!env?.DB) return fail('unavailable', 'DB not configured');
  const userId = trim(scope?.userId);
  if (!userId) return fail('unauthenticated', 'user required');
  const toolProfileError = await validateToolProfile(env, input);
  if (toolProfileError) return fail('validation', toolProfileError);
  const out = await updateSubagentProfile(env, scope, id, input);
  if (!out?.ok) {
    const kind = mapStoreError(out?.error);
    const message = out?.error === 'slug_already_exists'
      ? 'A subagent with this slug already exists in this workspace'
      : out?.error === 'not_found'
        ? 'Subagent not found'
        : out?.error || 'subagent_update_failed';
    return fail(kind, message);
  }
  return { ok: true, body: { ok: true, subagent: out.subagent } };
}

export async function deleteSubagentForSettings(env, scope, id) {
  if (!env?.DB) return fail('unavailable', 'DB not configured');
  const userId = trim(scope?.userId);
  if (!userId) return fail('unauthenticated', 'user required');
  const out = await deleteSubagentProfile(env, {
    id,
    userId,
    workspaceId: trim(scope?.workspaceId),
    allowPlatform: false,
  });
  if (!out?.ok) return fail(mapStoreError(out?.error), out?.error || 'delete_failed');
  return {
    ok: true,
    body: {
      ok: true,
      deleted: trim(id),
      hard_deleted: true,
      routing_arms_detached: out.routing_arms_detached ?? 0,
    },
  };
}
