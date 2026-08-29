import { runHyperdriveQuery } from '../../services/database/hyperdrive.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isWorkspaceUuid(value) {
  return UUID_RE.test(String(value || '').trim());
}

function candidates(value) {
  const key = String(value || '').trim();
  if (!key) return [];
  return [...new Set([key, key.startsWith('ws_') ? key.slice(3) : `ws_${key}`])].filter(Boolean);
}

export async function resolveSemanticWorkspaceId(env, d1WorkspaceId) {
  const key = String(d1WorkspaceId || '').trim();
  if (!key) return null;
  if (isWorkspaceUuid(key)) return key;

  if (env?.DB) {
    const row = await env.DB.prepare(
      'SELECT supabase_workspace_id FROM agentsam_workspace WHERE id = ? LIMIT 1',
    ).bind(key).first().catch(() => null);
    const bridged = String(row?.supabase_workspace_id || '').trim();
    if (isWorkspaceUuid(bridged)) return bridged;
  }

  for (const candidate of candidates(key)) {
    const result = await runHyperdriveQuery(
      env,
      'SELECT id::text AS id FROM agentsam.agentsam_workspaces WHERE workspace_key = $1 LIMIT 1',
      [candidate],
    );
    const id = String(result?.rows?.[0]?.id || '').trim();
    if (result.ok && isWorkspaceUuid(id)) return id;
  }
  return null;
}
