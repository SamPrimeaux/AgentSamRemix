/**
 * Workspace knowledge_generation counter — version invalidation for bootstrap/cache.
 * D1 is canonical; KV (if used later) is disposable acceleration only.
 */
import { pragmaTableInfo } from '../retention.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {any} env
 * @param {string} tenantId
 * @param {string} workspaceId
 * @returns {Promise<number>}
 */
export async function getKnowledgeGeneration(env, tenantId, workspaceId) {
  const tid = trim(tenantId);
  const ws = trim(workspaceId);
  if (!env?.DB || !tid || !ws) return 1;
  const cols = await pragmaTableInfo(env.DB, 'agentsam_knowledge_generation');
  if (!cols.size) return 1;
  try {
    const row = await env.DB.prepare(
      `SELECT generation FROM agentsam_knowledge_generation WHERE workspace_id = ? LIMIT 1`,
    )
      .bind(ws)
      .first();
    return Math.max(1, Math.floor(Number(row?.generation) || 1));
  } catch {
    return 1;
  }
}

/**
 * Bump generation after meaningful knowledge mutation.
 * @param {any} env
 * @param {{ tenant_id: string, workspace_id: string, delta?: number }} p
 * @returns {Promise<number>}
 */
export async function bumpKnowledgeGeneration(env, p) {
  const tid = trim(p.tenant_id);
  const ws = trim(p.workspace_id);
  if (!env?.DB || !tid || !ws) return 1;
  const cols = await pragmaTableInfo(env.DB, 'agentsam_knowledge_generation');
  if (!cols.size) return 1;
  const delta = Math.max(1, Math.floor(Number(p.delta) || 1));
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_knowledge_generation (workspace_id, tenant_id, generation, updated_at_unix)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         generation = agentsam_knowledge_generation.generation + excluded.generation,
         updated_at_unix = excluded.updated_at_unix`,
    )
      .bind(ws, tid, delta, now)
      .run();
    return getKnowledgeGeneration(env, tid, ws);
  } catch (e) {
    console.warn('[knowledge_generation] bump', e?.message ?? e);
    return 1;
  }
}

/**
 * Classify semantic scope affected by a memory commit for targeted invalidation.
 * @param {{ memory_type?: string, memory_key?: string, scope_type?: string }} draft
 */
export function classifyKnowledgeScopeLayer(draft = {}) {
  const type = trim(draft.memory_type).toLowerCase();
  const key = trim(draft.memory_key || draft.key).toLowerCase();
  if (key.startsWith('state:workspace:') || type === 'state') return 'workspace_state';
  if (key.startsWith('state:project:') || key.includes(':project:')) return 'project_state';
  if (type === 'policy' || key.startsWith('policy:')) return 'workspace_policy';
  if (type === 'preference' || key.startsWith('preference:')) return 'user_preference';
  if (key.startsWith('evolution:')) return 'evolution';
  return 'semantic_knowledge';
}
