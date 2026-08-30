/**
 * Hybrid memory recall — exact → pinned/recent → D1-selected pgvector → lexical → D1 hydrate.
 * Semantic search reads Supabase pgvector via MemoryService; Vectorize is not queried (cost dedupe).
 */
import { isHyperdriveUsable } from '../../backend/services/database/hyperdrive.js';
import { searchSemanticMemory } from './memory-service-bridge.js';
import {
  memoryExcludeNoiseSourcesSql,
  wantsMemoryNoiseSources,
} from './agentsam-memory-curation.js';
import {
  isTransportWorkspaceKey,
  resolveMemoryAuth,
  resolveMemorySemanticScope,
  resolveSourceClient,
} from './agentsam-memory-scope.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function textContent(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

/** Cosine / hybrid score floor for semantic (pgvector) hits. Exact/pinned/lexical exempt. */
export const MEMORY_MIN_SEMANTIC_SCORE = 0.35;

export const MEMORY_PIPELINE_VERSION = 'agentsam_memory_v1';

/** Provenance kinds that must clear MEMORY_MIN_SEMANTIC_SCORE. */
const SEMANTIC_PROVENANCE = new Set(['pgvector']);

/**
 * @param {Record<string, unknown>} env
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {Record<string, unknown>} workspace
 * @param {Record<string, unknown>} args
 */
export async function executeAgentsamMemoryHybridSearch(env, db, workspace, args = {}) {
  const auth = await resolveMemoryAuth(env, workspace);
  const tenantId = auth.tenant_id;
  const userId = auth.user_id;
  if (!db || !tenantId || !userId) {
    return textContent({ ok: false, error: 'auth_scope_required' });
  }

  // Never trust agent-supplied user/tenant for filter override
  if (trim(args.user_id) && trim(args.user_id) !== userId) {
    return textContent({ ok: false, error: 'agent_supplied_user_id_rejected' });
  }

  const scope = await resolveMemorySemanticScope({
    auth: { ...auth, authorized_workspaces: workspace?.authorized_workspaces },
    args,
    env,
  });
  // Search still runs if UUID mapping missing (D1 recall works); projection-only errors are soft.
  const hardScopeErrors = (scope.errors || []).filter(
    (e) => e === 'workspace_not_authorized' || e === 'transport_workspace_cannot_be_semantic_scope',
  );
  if (hardScopeErrors.length) {
    return textContent({
      ok: false,
      error: 'scope_resolution_failed',
      errors: scope.errors,
    });
  }

  const semanticWorkspaceId = scope.active_project_workspace_key;
  const transportWorkspaceKey = scope.transport_workspace_key;
  const sourceClient = scope.source_client || resolveSourceClient(workspace, args);
  const includeNoise = wantsMemoryNoiseSources(args);
  const noiseSql = includeNoise ? '1=1' : memoryExcludeNoiseSourcesSql('source');

  const query = trim(args.query) || trim(args.q) || '';
  const memoryKey = trim(args.memory_key) || trim(args.key);
  const topK = Math.min(50, Math.max(1, Number(args.top_k ?? args.limit) || 5));
  const now = Math.floor(Date.now() / 1000);
  const hits = new Map();

  const push = (row, provenance, score) => {
    if (!row?.memory_id && !row?.id) return;
    if (trim(row.status) && !['active', ''].includes(trim(row.status))) return;
    if (row.expires_at && Number(row.expires_at) > 0 && Number(row.expires_at) < now) return;
    if (Number(row.is_archived) === 1) return;
    if (!includeNoise) {
      const src = trim(row.source);
      if (src === 'post_deploy_hook' || src === 'daily_memory_pipeline') return;
    }
    // Never treat transport MCP workspace as a silo filter match for foreign rows
    const rowWs = trim(row.workspace_id);
    if (rowWs && isTransportWorkspaceKey(rowWs)) return;
    const mid = trim(row.memory_id) || trim(row.id);
    const existing = hits.get(mid);
    if (!existing || score > existing.score) {
      hits.set(mid, { memory_id: mid, score, provenance, row });
    }
  };

  // 1) Exact memory_key
  if (memoryKey) {
    const exact = await db
      .prepare(
        `SELECT * FROM agentsam_memory
          WHERE tenant_id = ? AND user_id = ? AND key = ? AND status = 'active'
            AND ${noiseSql}
          LIMIT 1`,
      )
      .bind(tenantId, userId, memoryKey)
      .first();
    if (exact) push(exact, 'exact_key', 1.0);
  }

  // 2) Pinned / important / recent — only seed when there is no semantic query
  if (!query) {
    const pinned = await db
      .prepare(
        `SELECT * FROM agentsam_memory
          WHERE tenant_id = ? AND user_id = ? AND status = 'active'
            AND ${noiseSql}
            AND (is_pinned = 1 OR importance >= 8)
            AND (expires_at IS NULL OR expires_at = 0 OR expires_at > ?)
          ORDER BY is_pinned DESC, importance DESC, updated_at DESC
          LIMIT ?`,
      )
      .bind(tenantId, userId, now, topK)
      .all();
    for (const r of pinned.results || []) push(r, 'pinned_important', 0.85);
  }

  if (!query && !memoryKey) {
    const recent = await db
      .prepare(
        `SELECT * FROM agentsam_memory
          WHERE tenant_id = ? AND user_id = ? AND status = 'active'
            AND ${noiseSql}
            AND (expires_at IS NULL OR expires_at = 0 OR expires_at > ?)
          ORDER BY updated_at DESC LIMIT ?`,
      )
      .bind(tenantId, userId, now, topK)
      .all();
    for (const r of recent.results || []) push(r, 'recent', 0.5);
    return finalize(hits, topK, {
      query: null,
      used_semantic: false,
      source_client: sourceClient,
      transport_workspace_key: transportWorkspaceKey,
      active_project_workspace_key: semanticWorkspaceId,
      noise_sources_excluded: !includeNoise,
    });
  }

  // 3) Semantic pgvector — exactly one D1-selected embedding space.
  let usedSemantic = false;
  let usedPgvector = false;
  if (query && semanticWorkspaceId && isHyperdriveUsable(env)) {
    try {
      const semHits = await searchSemanticMemory(env, {
        workspaceId: semanticWorkspaceId,
        query,
        limit: topK * 2,
        subjectId: userId,
        tenantId,
      });
      if (semHits.length) {
        usedPgvector = true;
        usedSemantic = true;
        for (const r of semHits) {
          const meta = r.metadata || {};
          push(
            {
              memory_id: meta.memory_id || r.id,
              key: meta.memory_key,
              status: 'active',
              content_hash: r.content_hash,
              revision: meta.revision,
            },
            'pgvector',
            Number(r.rank_score ?? r.semantic_score) || 0,
          );
        }
      }
    } catch {
      /* semantic lane/config/provider failure is soft; lexical recall still runs */
    }
  }

  // 5) Lexical / LIKE
  if (query) {
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9:_-]/gi, ''))
      .filter((t) => t.length >= 2)
      .slice(0, 6);
    if (tokens.length) {
      const like = `%${tokens[0]}%`;
      const lex = await db
        .prepare(
          `SELECT * FROM agentsam_memory
            WHERE tenant_id = ? AND user_id = ? AND status = 'active'
              AND ${noiseSql}
              AND (expires_at IS NULL OR expires_at = 0 OR expires_at > ?)
              AND (lower(key) LIKE ? OR lower(value) LIKE ? OR lower(COALESCE(title,'')) LIKE ?)
            ORDER BY importance DESC, updated_at DESC
            LIMIT ?`,
        )
        .bind(tenantId, userId, now, like, like, like, topK)
        .all();
      for (const r of lex.results || []) push(r, 'lexical', 0.45);
    }
  }

  // 8) Hydrate canonical D1 revisions for vector-only hits
  for (const [mid, hit] of hits) {
    if (hit.row?.value) continue;
    const full = await db
      .prepare(
        `SELECT * FROM agentsam_memory
          WHERE memory_id = ? AND status = 'active'
            AND tenant_id = ? AND user_id = ?
          LIMIT 1`,
      )
      .bind(mid, tenantId, userId)
      .first();
    if (full) hit.row = full;
    else hits.delete(mid);
  }

  try {
    return finalize(hits, topK, {
      query,
      used_semantic: usedSemantic,
      used_pgvector: usedPgvector,
      source_client: sourceClient,
      transport_workspace_key: transportWorkspaceKey,
      active_project_workspace_key: semanticWorkspaceId,
      min_semantic_score: Number(args.min_semantic_score) || undefined,
      noise_sources_excluded: !includeNoise,
    });
  } catch (e) {
    return textContent({
      ok: false,
      error: e?.message || String(e),
      count: 0,
      items: [],
    });
  }
}

function finalize(hits, topK, meta) {
  const minSemantic =
    Number.isFinite(Number(meta?.min_semantic_score)) && Number(meta.min_semantic_score) > 0
      ? Number(meta.min_semantic_score)
      : MEMORY_MIN_SEMANTIC_SCORE;

  const ranked = [...hits.values()].sort((a, b) => b.score - a.score);
  const filtered = ranked.filter((h) => {
    const rowWs = trim(h.row?.workspace_id);
    if (rowWs && isTransportWorkspaceKey(rowWs)) return false;
    if (!SEMANTIC_PROVENANCE.has(h.provenance)) return true;
    return Number(h.score) >= minSemantic;
  });

  const items = filtered.slice(0, topK).map((h) => ({
    memory_id: h.memory_id,
    memory_key: h.row?.key,
    revision: h.row?.revision ?? null,
    content_hash: h.row?.content_hash ?? null,
    memory_type: h.row?.memory_type,
    title: h.row?.title,
    summary: h.row?.summary,
    content: h.row?.value,
    workspace_id: h.row?.workspace_id ?? null,
    workspace_key: h.row?.workspace_id ?? null,
    scope_type: h.row?.scope_type ?? null,
    scope_id: h.row?.scope_id ?? null,
    importance: h.row?.importance,
    is_pinned: Number(h.row?.is_pinned) === 1,
    projection_status: h.row?.projection_status,
    projection_ready: h.row?.projection_status === 'ready',
    score: h.score,
    provenance: h.provenance,
    hydrated_from_d1: Boolean(h.row?.value || h.row?.content_hash),
    staleness:
      h.row?.projection_status && h.row.projection_status !== 'ready' ? 'projection_not_ready' : null,
  }));

  const suppressedLowScore = ranked.length - filtered.length;
  const emptyReason =
    items.length === 0 && (meta?.query || meta?.used_semantic || meta?.used_pgvector)
      ? 'no_relevant_memory'
      : null;

  return textContent({
    ok: true,
    pipeline_version: MEMORY_PIPELINE_VERSION,
    provider_path: 'iam_main_hybrid_recall',
    route: 'canonical_d1_hydrate',
    source_client: meta?.source_client ?? null,
    transport_workspace_key: meta?.transport_workspace_key ?? null,
    active_project_workspace_key: meta?.active_project_workspace_key ?? null,
    min_semantic_score: minSemantic,
    suppressed_low_score: suppressedLowScore,
    noise_sources_excluded: meta?.noise_sources_excluded !== false,
    count: items.length,
    items,
    results: items,
    reason: emptyReason,
    meta: {
      ...meta,
      pipeline_version: MEMORY_PIPELINE_VERSION,
      used_semantic: meta?.used_semantic === true,
      used_pgvector: meta?.used_pgvector === true,
      noise_sources_excluded: meta?.noise_sources_excluded !== false,
    },
  });
}
