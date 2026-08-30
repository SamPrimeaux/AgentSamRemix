/**
 * Hyperdrive reads for AgentSam Postgres (memory lane).
 * Run/tool/error ledgers stay on D1 — do not dual-write them here.
 */
import { isHyperdriveUsable, runHyperdriveQuery } from '../../backend/services/database/hyperdrive.js';
import { resolveSupabaseWorkspaceId } from '../../backend/rag/index.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/** Deterministic UUID from D1 agent_run id (workflow debug store join key). */
export async function uuidFromD1AgentRunId(d1AgentRunId) {
  const raw = trim(d1AgentRunId);
  if (!raw) return crypto.randomUUID();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return raw.toLowerCase();
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`agentsam_workflow_run:${raw}`),
  );
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Latest daily_memory_pipeline briefing for chat preflight (Hyperdrive).
 * @returns {Promise<string>}
 */
export async function fetchLatestDailyMemoryBriefing(env, d1WorkspaceId, opts = {}) {
  const d1Ws = trim(d1WorkspaceId);
  if (!d1Ws || !isHyperdriveUsable(env)) return '';
  const wsUuid = await resolveSupabaseWorkspaceId(env, d1Ws);
  if (!wsUuid) return '';

  const userFilter = trim(opts.userId);
  let sql = `
    SELECT title, content, memory_key, created_at
      FROM agentsam.agentsam_memory_oai3large_1536
     WHERE workspace_id = $1::uuid
       AND source = 'daily_memory_pipeline'
  `;
  const params = [wsUuid];
  if (userFilter) {
    sql += ` AND (
      metadata->>'user_id' = $2
      OR memory_key LIKE '%' || $2 || '%'
    )`;
    params.push(userFilter);
  }
  sql += ` ORDER BY created_at DESC LIMIT 1`;

  const r = await runHyperdriveQuery(env, sql, params);
  if (!r?.ok || !r.rows?.length) return '';
  const row = r.rows[0];
  const title = trim(row.title) || 'Daily memory';
  const body = trim(row.content);
  if (!body) return '';
  const clipped = body.length > 3500 ? `${body.slice(0, 3500)}\n…` : body;
  return `## Daily briefing (memory lane)\n\n**${title}**\n\n${clipped}`;
}
