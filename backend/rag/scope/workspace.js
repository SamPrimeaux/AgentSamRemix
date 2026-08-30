/**
 * D1 workspace key ↔ Supabase agentsam workspace UUID resolution.
 */
import {
  isHyperdriveUsable,
  runHyperdriveQuery,
} from '../../services/database/hyperdrive.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSupabaseWorkspaceUuid(value) {
  return UUID_RE.test(String(value || '').trim());
}

function workspaceKeyCandidates(value) {
  const key = String(value || '').trim();
  if (!key) return [];
  const out = [key];
  if (key.startsWith('ws_') && key.length > 3) out.push(key.slice(3));
  else if (!key.startsWith('ws_')) out.push(`ws_${key}`);
  return [...new Set(out)];
}

async function lookupPgWorkspace(env, d1WorkspaceId) {
  for (const candidate of workspaceKeyCandidates(d1WorkspaceId)) {
    const result = await runHyperdriveQuery(
      env,
      'SELECT id FROM agentsam.agentsam_workspaces WHERE workspace_key = $1 LIMIT 1',
      [candidate],
    ).catch(() => null);
    const id = result?.rows?.[0]?.id;
    if (id != null && isSupabaseWorkspaceUuid(id)) return String(id);
  }
  return null;
}

export async function resolveSupabaseWorkspaceId(env, d1WorkspaceId) {
  const key = String(d1WorkspaceId || '').trim();
  if (!key) return null;
  if (isSupabaseWorkspaceUuid(key)) return key;

  if (env?.DB) {
    const row = await env.DB.prepare(
      'SELECT supabase_workspace_id FROM agentsam_workspace WHERE id = ? LIMIT 1',
    )
      .bind(key)
      .first()
      .catch(() => null);
    const bridged = row?.supabase_workspace_id != null ? String(row.supabase_workspace_id).trim() : '';
    if (isSupabaseWorkspaceUuid(bridged)) return bridged;
  }

  const fromPg = await lookupPgWorkspace(env, key);
  if (fromPg) return fromPg;

  const platformKey = String(env?.WORKSPACE_ID || '').trim();
  if (platformKey && platformKey === key) {
    for (const envKey of ['IAM_SUPABASE_WORKSPACE_ID', 'SUPABASE_WORKSPACE_UUID', 'SUPABASE_WORKSPACE_ID']) {
      const value = String(env?.[envKey] || '').trim();
      if (isSupabaseWorkspaceUuid(value)) return value;
    }
  }
  return null;
}

async function ensurePgWorkspace(env, { uuid = null, d1WorkspaceId, displayName }) {
  if (!isHyperdriveUsable(env)) throw new Error('workspace_uuid_provision_requires_hyperdrive');
  const preferred = isSupabaseWorkspaceUuid(uuid) ? String(uuid).trim() : '';
  const metadata = JSON.stringify({
    d1_workspace_id: d1WorkspaceId,
    provisioned_by: 'backend/rag/scope/workspace',
  });

  if (preferred) {
    const existing = await runHyperdriveQuery(
      env,
      'SELECT id::text AS id FROM agentsam.agentsam_workspaces WHERE id = $1::uuid LIMIT 1',
      [preferred],
    );
    if (existing?.ok && isSupabaseWorkspaceUuid(existing.rows?.[0]?.id)) {
      return String(existing.rows[0].id);
    }
  }

  for (const candidate of workspaceKeyCandidates(d1WorkspaceId)) {
    const existing = await runHyperdriveQuery(
      env,
      'SELECT id::text AS id FROM agentsam.agentsam_workspaces WHERE workspace_key = $1 LIMIT 1',
      [candidate],
    );
    if (existing?.ok && isSupabaseWorkspaceUuid(existing.rows?.[0]?.id)) {
      return String(existing.rows[0].id);
    }
  }

  const params = preferred
    ? [preferred, d1WorkspaceId, displayName, metadata]
    : [d1WorkspaceId, displayName, metadata];
  const sql = preferred
    ? `INSERT INTO agentsam.agentsam_workspaces
         (id, workspace_key, display_name, is_active, metadata)
       VALUES ($1::uuid, $2, $3, true, $4::jsonb)
       ON CONFLICT (id) DO UPDATE
         SET display_name = EXCLUDED.display_name, is_active = true, updated_at = now()
       RETURNING id::text AS id`
    : `INSERT INTO agentsam.agentsam_workspaces
         (workspace_key, display_name, is_active, metadata)
       VALUES ($1, $2, true, $3::jsonb)
       ON CONFLICT (workspace_key) DO UPDATE
         SET display_name = EXCLUDED.display_name, is_active = true, updated_at = now()
       RETURNING id::text AS id`;
  const inserted = await runHyperdriveQuery(env, sql, params);
  if (!inserted?.ok) throw new Error(inserted?.error || 'workspace_uuid_provision_failed');
  const id = String(inserted.rows?.[0]?.id || '').trim();
  if (!isSupabaseWorkspaceUuid(id)) throw new Error('workspace_uuid_provision_invalid');
  return id;
}

export async function ensureSupabaseWorkspaceId(env, d1WorkspaceId) {
  const key = String(d1WorkspaceId || '').trim();
  if (!key) throw new Error('workspace_id_required');
  if (!env?.DB) throw new Error('workspace_uuid_provision_requires_d1');

  const row = await env.DB.prepare(
    `SELECT id, display_name, name, status, supabase_workspace_id
       FROM agentsam_workspace WHERE id = ? LIMIT 1`,
  )
    .bind(key)
    .first()
    .catch(() => null);
  if (!row?.id) throw new Error(`workspace_registry_missing:${key}`);
  if (String(row.status || '').toLowerCase() !== 'active') {
    throw new Error(`workspace_inactive:${key}`);
  }
  if (!isHyperdriveUsable(env)) throw new Error('workspace_uuid_provision_requires_hyperdrive');

  const existing = String(row.supabase_workspace_id || '').trim();
  const uuid = await ensurePgWorkspace(env, {
    uuid: isSupabaseWorkspaceUuid(existing) ? existing : await resolveSupabaseWorkspaceId(env, key),
    d1WorkspaceId: key,
    displayName: String(row.display_name || row.name || key).trim() || key,
  });
  if (existing !== uuid) {
    await env.DB.prepare(
      'UPDATE agentsam_workspace SET supabase_workspace_id = ?, updated_at = unixepoch() WHERE id = ?',
    )
      .bind(uuid, key)
      .run();
  }
  return uuid;
}
