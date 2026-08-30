/**
 * Unified knowledge retrieval — wraps hybrid memory search with protocol ranking.
 */
import { executeAgentsamMemoryHybridSearch } from '../../../src/core/agentsam-memory-hybrid-search.js';
import { knowledgeRefFromMemoryRow } from './contract/packet.js';
import { tableExists } from '../retention.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function parseSearchBody(out) {
  const text = out?.content?.[0]?.text;
  if (typeof text !== 'string') return out;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: 'unparseable_search_response' };
  }
}

const TYPE_RANK = Object.freeze({
  state: 100,
  policy: 90,
  decision: 85,
  procedure: 80,
  error: 75,
  preference: 70,
  fact: 60,
  event: 50,
});

/**
 * @param {Record<string, unknown>} hit
 * @param {string} query
 */
function rankKnowledgeHit(hit, query) {
  const row = hit.row || hit;
  const type = trim(row.memory_type || row.type).toLowerCase();
  const base = TYPE_RANK[type] || 55;
  const importance = Number(row.importance) || 5;
  const score = Number(hit.score) || 0;
  const key = trim(row.key || row.memory_key);
  let boost = 0;
  if (key && query && key.includes(query.toLowerCase().slice(0, 20))) boost += 15;
  if (Number(row.is_pinned) === 1) boost += 20;
  if (type === 'state' || type === 'error') boost += score * 10;
  else boost += score * 5;
  return base + importance + boost;
}

/**
 * @param {any} env
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {{
 *   query?: string,
 *   tenantId?: string,
 *   workspaceId?: string,
 *   userId?: string,
 *   projectId?: string,
 *   knowledgeTypes?: string[],
 *   maxItems?: number,
 *   includeRecentExperience?: boolean,
 *   includeGlobalPolicies?: boolean,
 *   includeProjectState?: boolean,
 * }} opts
 */
export async function retrieveKnowledge(env, db, opts = {}) {
  const tenantId = trim(opts.tenantId);
  const userId = trim(opts.userId);
  const workspaceId = trim(opts.workspaceId);
  const query = trim(opts.query);
  const maxItems = Math.min(Math.max(Number(opts.maxItems) || 12, 1), 32);

  if (!db || !tenantId || !userId) {
    return { ok: false, error: 'auth_scope_required', hits: [] };
  }

  const workspace = {
    tenant_id: tenantId,
    user_id: userId,
    workspace_id: workspaceId || undefined,
  };

  const hits = [];

  if (query || opts.knowledgeTypes?.length) {
    const searchOut = await executeAgentsamMemoryHybridSearch(env, db, workspace, {
      query,
      q: query,
      top_k: maxItems * 2,
      workspace_id: workspaceId,
      project_id: opts.projectId,
    });
    const body = parseSearchBody(searchOut);
    const rows = body?.hits || body?.results || [];
    for (const h of rows) {
      const row = h.row || h;
      const type = trim(row.memory_type || row.type).toLowerCase();
      if (opts.knowledgeTypes?.length && !opts.knowledgeTypes.includes(type)) continue;
      hits.push({
        ...knowledgeRefFromMemoryRow(row, Number(h.score) || 0.5),
        row,
        rank: rankKnowledgeHit(h, query),
        provenance: 'semantic_search',
      });
    }
  }

  if (opts.includeGlobalPolicies !== false && workspaceId) {
    const policyKeys = [
      `policy:agent-routing:thompson-single-writer`,
      `state:workspace:${workspaceId}:current`,
    ];
    if (opts.projectId) {
      policyKeys.push(`state:project:${trim(opts.projectId)}:current`);
    }
    for (const key of policyKeys) {
      const row = await db
        .prepare(
          `SELECT id, memory_id, key, memory_type, title, summary, value, importance, confidence, source, is_pinned
             FROM agentsam_memory
            WHERE tenant_id = ? AND user_id = ? AND key = ? AND status = 'active'
            LIMIT 1`,
        )
        .bind(tenantId, userId, key)
        .first()
        .catch(() => null);
      if (row) {
        hits.push({
          ...knowledgeRefFromMemoryRow(row, 1),
          row,
          rank: 200,
          provenance: 'exact_key',
        });
      }
    }
  }

  if (opts.includeRecentExperience && (await tableExists(db, 'agentsam_agent_experience'))) {
    const since = Math.floor(Date.now() / 1000) - 7 * 86400;
    const { results } = await db
      .prepare(
        `SELECT id, agent_run_id, outcome, task_type, model_key, cost_usd, failure_category, reward, created_at_unix
           FROM agentsam_agent_experience
          WHERE workspace_id = ? AND created_at_unix >= ?
            AND outcome IN ('useful_success','partial','failed')
          ORDER BY created_at_unix DESC
          LIMIT 5`,
      )
      .bind(workspaceId, since)
      .all()
      .catch(() => ({ results: [] }));
    for (const r of results || []) {
      hits.push({
        id: r.id,
        key: `experience:${r.id}`,
        type: 'event',
        title: `Prior ${r.task_type} run (${r.outcome})`,
        summary: `${r.model_key || 'model'} · $${Number(r.cost_usd || 0).toFixed(4)} · reward ${Number(r.reward || 0).toFixed(2)}`,
        provenance: 'experience',
        relevance: 0.4,
        rank: 40,
      });
    }
  }

  hits.sort((a, b) => (b.rank || 0) - (a.rank || 0));
  const dedup = new Map();
  for (const h of hits) {
    const k = trim(h.id) || trim(h.key);
    if (!k || dedup.has(k)) continue;
    dedup.set(k, h);
    if (dedup.size >= maxItems) break;
  }

  return { ok: true, hits: [...dedup.values()], query };
}
