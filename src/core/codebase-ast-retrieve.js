/**
 * AST / Graph RAG retrieve — Phase 3 core, Phase 4 tool surface.
 *
 * Route first (no double-read):
 *   structural → D1 codebase_ast_nodes (+ optional dep_edges) and STOP
 *   semantic   → pgvector ANN → optional D1 expand → optional chunk hydrate
 * Escalate structural → semantic only when D1 returns no hits.
 *
 * Phase 2 fills the symbol table. This module is the runtime glue.
 * Wire into catalog-tool-executor as agentsam_codebase_retrieve (migration 954).
 */

import {
  createAgentsamEmbedding,
  isOpenAiBillingOrQuotaError,
} from './agentsam-vectorize.js';
import { runHyperdriveQuery, isHyperdriveUsable } from '../../backend/services/database/hyperdrive.js';
import {
  resolveCodeIndexLaneConfig,
  requireCodeIndexLaneConfig,
  embedSpecFromCodeIndexLaneConfig,
} from '../../backend/agentsam/codebase/code-index-lane-resolve.js';
export {
  expandAstGraph,
  normalizeEdgeTypes,
  normalizeGraphDirection,
} from './codebase-ast-graph-expand.js';
import { expandAstGraph } from './codebase-ast-graph-expand.js';
export {
  classifyCodebaseRetrieveIntent,
  extractStructuralTarget,
  lookupAstSymbolsExact,
  normalizeRetrieveMode,
} from './codebase-ast-retrieve-route.js';
import {
  classifyCodebaseRetrieveIntent,
  lookupAstSymbolsExact,
} from './codebase-ast-retrieve-route.js';
import { resolveActiveCodeIndexGeneration } from '../../backend/agentsam/codebase/code-index-generation.js';

export const CODEBASE_RETRIEVE_EMBED_QUOTA_HINT =
  'Gemini embedding unavailable for codebase ANN (gemini-embedding-2). Use fs_search_files, fs_read_file, or agentsam_terminal_local instead of agentsam_codebase_retrieve.';

/**
 * Resolve the retrieve search string from tool args.
 * Models often invent aliases (information_request / symbol) instead of required `query`
 * (live proof: empty_query with only information_request set).
 *
 * @param {Record<string, unknown>|null|undefined} params
 * @returns {string}
 */
export function resolveCodebaseRetrieveQuery(params) {
  const p = params && typeof params === 'object' ? params : {};
  const candidates = [
    p.query,
    p.q,
    p.symbol,
    p.name,
    p.target,
    p.search,
    p.information_request,
    p.informationRequest,
    p.question,
    p.prompt,
    p.text,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === 'string') {
      const s = c.trim();
      if (s) return s;
      continue;
    }
    if (typeof c === 'number' || typeof c === 'boolean') {
      const s = String(c).trim();
      if (s) return s;
    }
  }
  return '';
}

/**
 * Steer the model to chain retrieve hops instead of falling back to fs_search_files / grep.
 * @param {{
 *   query?: string,
 *   direction_applied?: string|null,
 *   edge_count?: number,
 *   neighbors?: Array<{ node_name?: string|null }>,
 *   symbol_hits?: unknown[],
 * }} out
 * @returns {null|{ next_action: string, message: string, suggested_queries: string[], avoid?: string[] }}
 */
export function buildStructuralRetrieveOrchestrationHint(out) {
  const neighbors = Array.isArray(out?.neighbors) ? out.neighbors : [];
  const names = [
    ...new Set(
      neighbors
        .map((n) => String(n?.node_name || '').trim())
        .filter((n) => n && n.length < 120),
    ),
  ].slice(0, 8);
  const dir = out?.direction_applied != null ? String(out.direction_applied) : '';
  const edgeCount = Number(out?.edge_count || 0);
  const nextDir = dir === 'in' ? 'in' : 'out';
  const hopVerb = dir === 'in' ? 'callers' : dir === 'out' ? 'callees' : 'neighbors';

  if (edgeCount > 0 && names.length) {
    const knownList = names.join(', ');
    return {
      next_action: 'chain_retrieve',
      avoid: ['fs_search_files', 'github_api string grep as a call-graph substitute'],
      suggested_queries: names,
      message:
        `Call-graph hop ready (${edgeCount} edges, direction=${dir || 'both'}). ` +
        `These neighbors are already known — do NOT fs_search_files / grep them: ${knownList}. ` +
        `Continue with another agentsam_codebase_retrieve for each important ${hopVerb} ` +
        `(query=<name>, mode=structural, graph_direction=${nextDir}, edge_types=["calls"]). ` +
        `fs_search_files is only for non-call-graph contracts (e.g. queue message-type strings) ` +
        `after the AST hop chain dead-ends — never to re-derive names already returned here.`,
    };
  }

  if (Array.isArray(out?.symbol_hits) && out.symbol_hits.length && edgeCount === 0) {
    const seed = String(out.query || '').trim();
    return {
      next_action: 'retry_with_direction',
      avoid: ['fs_search_files'],
      suggested_queries: seed ? [seed] : [],
      message:
        'Symbol resolved but no edges expanded. Retry agentsam_codebase_retrieve with the same query, ' +
        'mode=structural, graph_direction=out (callees) or in (callers), edge_types=["calls"], expand=true. ' +
        'Do not fs_search_files for this symbol until retrieve returns empty edges.',
    };
  }

  return null;
}

/** Min symbol length before we treat a grep query as "already known from retrieve". */
const RETRIEVE_KNOWN_SYMBOL_MIN_LEN = 6;

/**
 * Queue / message-contract greps are legitimate after an AST dead-end (MY_QUEUE.send is
 * not a `calls` edge to the consumer). Do not soft-block these even if a name overlaps.
 */
const QUEUE_BOUNDARY_FS_SEARCH_OK =
  /\b(FULL_INDEX_QUEUE_TYPE|MY_QUEUE|QueueMessage|message\.type|dispatchQueueMessage|handleCodebaseFullIndexQueueJob|queue\s*\()\b/i;

/**
 * Absorb symbol names from a successful agentsam_codebase_retrieve payload into a Set.
 * @param {unknown} payload
 * @param {Set<string>} into
 */
export function absorbRetrieveKnownSymbols(payload, into) {
  if (!into || typeof into.add !== 'function') return;
  const parsed =
    payload && typeof payload === 'object'
      ? /** @type {Record<string, unknown>} */ (payload)
      : null;
  if (!parsed || parsed.error || parsed.ok === false) return;

  const add = (raw) => {
    const s = String(raw || '').trim();
    if (s.length >= RETRIEVE_KNOWN_SYMBOL_MIN_LEN && s.length < 120) into.add(s);
  };

  add(parsed.query);
  const orch = parsed.orchestration && typeof parsed.orchestration === 'object'
    ? /** @type {Record<string, unknown>} */ (parsed.orchestration)
    : null;
  if (Array.isArray(orch?.suggested_queries)) {
    for (const q of orch.suggested_queries) add(q);
  }
  if (Array.isArray(parsed.neighbors)) {
    for (const n of parsed.neighbors) {
      if (n && typeof n === 'object') add(/** @type {{ node_name?: unknown }} */ (n).node_name);
    }
  }
  if (Array.isArray(parsed.symbol_hits)) {
    for (const h of parsed.symbol_hits) {
      if (h && typeof h === 'object') {
        const row = /** @type {{ node_name?: unknown, name?: unknown, symbol?: unknown }} */ (h);
        add(row.node_name || row.name || row.symbol);
      }
    }
  }
}

/**
 * @param {string} query
 * @param {Set<string>} known
 * @returns {{ matched: string } | null}
 */
export function matchFsSearchAgainstRetrieveKnown(query, known) {
  const q = String(query || '').trim();
  if (!q || !known?.size) return null;
  if (QUEUE_BOUNDARY_FS_SEARCH_OK.test(q)) return null;
  for (const s of known) {
    if (!s || s.length < RETRIEVE_KNOWN_SYMBOL_MIN_LEN) continue;
    if (q === s || q.includes(s)) return { matched: s };
  }
  return null;
}

/**
 * Soft tool_result when the model re-greps a symbol retrieve already returned.
 * @param {string} query
 * @param {string} matched
 * @param {string[]} knownSample
 */
export function softRetrieveFactAlreadyKnownResult(query, matched, knownSample = []) {
  return {
    ok: false,
    soft_validation_error: true,
    code: 'retrieve_fact_already_known',
    error: 'symbol_already_returned_by_agentsam_codebase_retrieve',
    query,
    matched_symbol: matched,
    known_symbols_sample: knownSample.slice(0, 12),
    hint:
      `"${matched}" was already returned by agentsam_codebase_retrieve. ` +
      `Chain another retrieve (mode=structural, graph_direction=out|in) or fs_read_file the known path. ` +
      `Use fs_search_files only for non-call-graph contracts after the AST hop dead-ends ` +
      `(e.g. queue message-type strings) — not to re-discover this symbol.`,
  };
}

/**
 * @param {number[]} embedding
 * @returns {string}
 */
function vectorLiteral(embedding) {
  return `[${embedding.map((x) => Number(x).toFixed(8)).join(',')}]`;
}

/**
 * @param {object} env
 * @param {string} query
 * @param {{
 *   topK?: number,
 *   workspaceUuid?: string,
 *   repo?: string|null,
 *   userId?: string|null,
 *   workspaceId?: string|null,
 *   tenantId?: string|null,
 *   sessionId?: string|null,
 *   conversationId?: string|null,
 *   usage?: false | Record<string, unknown>,
 * }} [opts]
 */
export async function searchAstSymbols(env, query, opts = {}) {
  await resolveCodeIndexLaneConfig(env);
  const lane = requireCodeIndexLaneConfig(env);
  const embedSpec = embedSpecFromCodeIndexLaneConfig(lane);
  const symbolsTable = `agentsam.${lane.tables.symbols}`;
  if (!isHyperdriveUsable(env)) {
    return { ok: false, error: 'hyperdrive_unavailable', hits: [] };
  }
  const topK = Math.min(Math.max(Number(opts.topK) || 8, 1), 32);
  const workspaceUuid = String(opts.workspaceUuid || '').trim();
  if (!workspaceUuid) throw new Error('supabase_workspace_uuid_required');
  const d1Ws = opts.workspaceId != null ? String(opts.workspaceId).trim() : '';
  const usage =
    opts.usage === false
      ? false
      : {
          workspace_id: d1Ws || undefined,
          tenant_id: opts.tenantId || undefined,
          user_id: opts.userId || undefined,
          session_id: opts.sessionId || undefined,
          conversation_id: opts.conversationId || undefined,
          task_type: 'ast_retrieve',
          tool_name: 'agentsam_codebase_retrieve',
          ref_table: lane.tables.symbols,
          ref_id: workspaceUuid,
          ...(opts.usage && typeof opts.usage === 'object' ? opts.usage : {}),
        };
  let embedding;
  let tokens_in;
  let apiUsage;
  try {
    const embOut = await createAgentsamEmbedding(env, query, {
      spec: embedSpec,
      userId: opts.userId ?? null,
      workspaceId: d1Ws || null,
      usage,
    });
    embedding = embOut.embedding;
    tokens_in = embOut.tokens_in;
    apiUsage = embOut.usage;
  } catch (e) {
    const msg = e?.message != null ? String(e.message) : String(e);
    if (e?.code === 'embedding_quota_exhausted' || isOpenAiBillingOrQuotaError(msg)) {
      return {
        ok: false,
        error: 'embedding_quota_exhausted',
        hint: CODEBASE_RETRIEVE_EMBED_QUOTA_HINT,
        hits: [],
      };
    }
    return { ok: false, error: msg || 'embedding_failed', hits: [] };
  }
  const lit = vectorLiteral(embedding);

  const params = [lit, workspaceUuid, topK];
  let repoClause = '';
  let genClause = '';
  let next = 4;
  if (opts.repo) {
    repoClause = ` AND repo_full_name = $${next}`;
    params.push(opts.repo);
    next += 1;
  }
  const generationId =
    opts.index_generation_id != null && String(opts.index_generation_id).trim()
      ? String(opts.index_generation_id).trim()
      : opts.indexGenerationId != null && String(opts.indexGenerationId).trim()
        ? String(opts.indexGenerationId).trim()
        : '';
  if (!generationId) {
    return { ok: false, error: 'index_generation_id_required', hits: [] };
  }
  genClause = ` AND index_generation_id = $${next}`;
  params.push(generationId);

  const sql = `
    SELECT node_id, node_type, node_name, file_path, repo_full_name, signature, line_start, line_end,
           1 - (embedding <=> $1::vector) AS score
    FROM ${symbolsTable}
    WHERE workspace_id = $2::uuid
      AND embedding IS NOT NULL
      ${repoClause}
      ${genClause}
    ORDER BY embedding <=> $1::vector
    LIMIT $3
  `;
  const r = await runHyperdriveQuery(env, sql, params);
  if (!r.ok) return { ok: false, error: r.error || 'pgvector_error', hits: [] };
  const hits = (r.rows || []).map((row) => ({
    node_id: row.node_id,
    node_type: row.node_type,
    node_name: row.node_name,
    file_path: row.file_path,
    repo_full_name: row.repo_full_name,
    // Legacy alias for tool consumers — same GitHub owner/name.
    repo: row.repo_full_name,
    signature: row.signature,
    line_start: row.line_start,
    line_end: row.line_end,
    score: row.score != null ? Number(row.score) : null,
  }));
  return {
    ok: true,
    hits,
    backend: 'pgvector_symbols',
    embed: { tokens_in: tokens_in ?? null, usage: apiUsage ?? null, model: embedSpec.model },
  };
}

/**
 * Hydrate chunk text for node ids via Hyperdrive.
 * @param {object} env
 * @param {string[]} nodeIds
 * @param {{ workspaceUuid?: string, limit?: number }} [opts]
 */
export async function hydrateChunksByNodeIds(env, nodeIds, opts = {}) {
  await resolveCodeIndexLaneConfig(env);
  const chunksTable = `agentsam.${requireCodeIndexLaneConfig(env).tables.chunks}`;
  if (!isHyperdriveUsable(env)) {
    return { ok: false, error: 'hyperdrive_unavailable', chunks: [] };
  }
  const ids = [...new Set((nodeIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) return { ok: true, chunks: [] };
  const workspaceUuid = String(opts.workspaceUuid || '').trim();
  if (!workspaceUuid) throw new Error('supabase_workspace_uuid_required');
  const limit = Math.min(Math.max(Number(opts.limit) || 24, 1), 64);
  const generationId =
    opts.index_generation_id != null && String(opts.index_generation_id).trim()
      ? String(opts.index_generation_id).trim()
      : opts.indexGenerationId != null && String(opts.indexGenerationId).trim()
        ? String(opts.indexGenerationId).trim()
        : '';
  if (!generationId) {
    return { ok: false, error: 'index_generation_id_required', chunks: [] };
  }

  const sql = `
    SELECT id::text AS chunk_id, node_id, file_path, chunk_index, content, token_count
    FROM ${chunksTable}
    WHERE workspace_id = $1::uuid
      AND index_generation_id = $2
      AND node_id = ANY($3::text[])
    ORDER BY file_path, chunk_index
    LIMIT $4
  `;
  const r = await runHyperdriveQuery(env, sql, [workspaceUuid, generationId, ids, limit]);
  if (!r.ok) return { ok: false, error: r.error || 'hydrate_error', chunks: [] };
  return { ok: true, chunks: r.rows || [], backend: 'hyperdrive_chunks' };
}

/**
 * Full Graph RAG retrieve for agent / MCP tool.
 * Classifies query type first — structural answers never touch Postgres.
 * @param {object} env
 * @param {string} query
 * @param {{
 *   topK?: number,
 *   expand?: boolean,
 *   hydrate?: boolean,
 *   repo?: string|null,
 *   workspaceId?: string,
 *   direction?: string,
 *   graphDirection?: string,
 *   edgeTypes?: string[]|string,
 *   edge_types?: string[]|string,
 *   mode?: string,
 *   intent?: string,
 *   escalate?: boolean,
 *   hydrateNeighbors?: boolean,
 * }} [opts]
 */
export async function retrieveCodebaseAstContext(env, query, opts = {}) {
  const t0 = Date.now();
  const q = String(query || '').trim();
  if (!q) {
    return {
      ok: false,
      error: 'empty_query',
      results: [],
      duration_ms: 0,
      hint:
        'query is required (symbol or function name). Example: query="queueFullCodeIndexRun", mode=structural, graph_direction=out, edge_types=["calls"].',
    };
  }

  const d1WorkspaceId = opts.workspaceId ? String(opts.workspaceId).trim() : '';
  const repoFullName = String(opts.repo_full_name || opts.repo || '').trim();
  const classified = classifyCodebaseRetrieveIntent(q, {
    mode: opts.mode ?? opts.intent,
  });

  // Resolve ACTIVE once per request — pass generation into every helper (no mid-request re-resolve).
  if (!d1WorkspaceId) {
    return {
      ok: false,
      error: 'workspace_id_required',
      results: [],
      duration_ms: Date.now() - t0,
    };
  }
  if (!repoFullName) {
    return {
      ok: false,
      error: 'repo_full_name_required',
      results: [],
      duration_ms: Date.now() - t0,
      hint: 'repo_full_name is required so retrieve can pin one ACTIVE generation.',
    };
  }
  const active = await resolveActiveCodeIndexGeneration(env, {
    workspaceId: d1WorkspaceId,
    repo_full_name: repoFullName,
  });
  if (!active.ok) {
    return {
      ok: false,
      error: active.error || 'active_code_index_generation_missing',
      route: classified.route === 'structural' ? 'structural_d1' : 'semantic_pgvector',
      results: [],
      duration_ms: Date.now() - t0,
      hint:
        'No is_active=1 code index job for this workspace+repo. Complete a Build/activate first.',
    };
  }
  const activeGeneration = {
    generationId: active.generationId,
    revisionSha: active.revisionSha,
    jobId: active.jobId,
  };

  /** Structural path: D1 only — no Hyperdrive, no embeddings. */
  if (classified.route === 'structural') {
    const target = classified.target;
    const exact = await lookupAstSymbolsExact(env, {
      workspaceId: d1WorkspaceId,
      name: target.name,
      file_path: target.file_path,
      repo_full_name: repoFullName,
      index_generation_id: activeGeneration.generationId,
      exported_only: target.exported_only,
      limit: opts.topK ?? 16,
    });

    if (exact.ok && exact.hits.length) {
      let nodeIds = exact.hits.map((h) => h.node_id);
      let edges = [];
      let neighbors = [];
      let direction_applied = null;
      let edge_types_applied = null;
      const wantExpand =
        opts.expand !== false &&
        (target.graph_direction != null ||
          classified.intent === 'calls_graph' ||
          classified.intent === 'imports_graph' ||
          opts.direction != null ||
          opts.graphDirection != null);

      if (wantExpand) {
        const g = await expandAstGraph(env, nodeIds, {
          workspaceId: d1WorkspaceId,
          index_generation_id: activeGeneration.generationId,
          direction: opts.direction ?? opts.graphDirection ?? target.graph_direction ?? 'both',
          graphDirection: opts.graphDirection ?? target.graph_direction,
          edgeTypes: opts.edgeTypes ?? opts.edge_types ?? target.edge_types,
        });
        if (g.ok) {
          nodeIds = g.node_ids;
          edges = g.edges || [];
          neighbors = g.neighbors || [];
          direction_applied = g.direction_applied ?? null;
          edge_types_applied = g.edge_types_applied ?? null;
        }
      }

      const results = exact.hits.map((h) => ({
        kind: 'symbol',
        node_id: h.node_id,
        file_path: h.file_path,
        content: h.signature || `${h.node_type} ${h.node_name}`,
        score: h.score,
        source: 'd1_ast_nodes',
      }));

      const structuralOut = {
        ok: true,
        query: q,
        route: 'structural_d1',
        query_intent: classified.intent,
        classify_reason: classified.reason,
        index_generation_id: activeGeneration.generationId,
        revision_sha: activeGeneration.revisionSha,
        symbol_hits: exact.hits,
        expanded_node_ids: nodeIds,
        edge_count: edges.length,
        edges,
        neighbors,
        direction_applied,
        edge_types_applied,
        results,
        result_count: results.length,
        duration_ms: Date.now() - t0,
        embed: null,
        note: 'structural_d1_terminated — no pgvector / chunk hydrate',
      };
      const orchestration = buildStructuralRetrieveOrchestrationHint(structuralOut);
      if (orchestration) structuralOut.orchestration = orchestration;
      return structuralOut;
    }

    // D1 cannot answer — escalate to semantic unless explicitly disabled.
    if (opts.escalate === false) {
      return {
        ok: true,
        query: q,
        route: 'structural_d1',
        query_intent: classified.intent,
        classify_reason: classified.reason,
        index_generation_id: activeGeneration.generationId,
        revision_sha: activeGeneration.revisionSha,
        symbol_hits: [],
        expanded_node_ids: [],
        edge_count: 0,
        edges: [],
        neighbors: [],
        results: [],
        result_count: 0,
        duration_ms: Date.now() - t0,
        embed: null,
        note: 'structural_d1_empty — escalate disabled',
      };
    }
  }

  let workspaceUuid = opts.workspaceUuid || null;
  if (!workspaceUuid && d1WorkspaceId) {
    try {
      const { resolveSupabaseWorkspaceId } = await import('../../backend/agentsam/rag/index.js');
      workspaceUuid = await resolveSupabaseWorkspaceId(env, d1WorkspaceId);
    } catch {
      /* resolution failure is handled below */
    }
  }
  if (!workspaceUuid) {
    return {
      ok: false,
      error: 'supabase_workspace_uuid_required',
      route: 'semantic_pgvector',
      results: [],
      duration_ms: Date.now() - t0,
    };
  }

  const sym = await searchAstSymbols(env, q, {
    topK: opts.topK ?? 8,
    repo: repoFullName || null,
    index_generation_id: activeGeneration.generationId,
    workspaceUuid,
    // Do not hardcode ws_inneranimalmedia — project-bound chats pass their exec workspace.
    workspaceId: d1WorkspaceId || undefined,
    userId: opts.userId ?? null,
    tenantId: opts.tenantId ?? null,
    sessionId: opts.sessionId ?? null,
    conversationId: opts.conversationId ?? null,
  });
  if (!sym.ok) {
    return {
      ok: false,
      error: sym.error,
      hint: sym.hint || undefined,
      route: 'semantic_pgvector',
      index_generation_id: activeGeneration.generationId,
      results: [],
      duration_ms: Date.now() - t0,
    };
  }

  const seedNodeIds = sym.hits.map((h) => h.node_id);
  let expandedNodeIds = seedNodeIds;
  let edges = [];
  let neighbors = [];
  let direction_applied = null;
  let edge_types_applied = null;
  if (opts.expand !== false) {
    const g = await expandAstGraph(env, seedNodeIds, {
      workspaceId: d1WorkspaceId || opts.workspaceId,
      index_generation_id: activeGeneration.generationId,
      direction: opts.direction ?? opts.graphDirection,
      graphDirection: opts.graphDirection,
      edgeTypes: opts.edgeTypes ?? opts.edge_types,
    });
    if (g.ok) {
      expandedNodeIds = g.node_ids;
      edges = g.edges || [];
      neighbors = g.neighbors || [];
      direction_applied = g.direction_applied ?? null;
      edge_types_applied = g.edge_types_applied ?? null;
    }
  }

  // Hydrate ANN seed hits only by default. Expanding then hydrating every neighbor
  // node pulls megabytes of dispatcher noise (e.g. handleSettingsRequest 3k+ LOC).
  // Edges/neighbors metadata still returned when expand=true; opt into neighbor
  // chunks with hydrateNeighbors / hydrate_neighbors.
  const hydrateNeighbors =
    opts.hydrateNeighbors === true ||
    opts.hydrate_neighbors === true ||
    opts.hydrateNeighbors === 'true' ||
    opts.hydrate_neighbors === 'true';
  const hydrateNodeIds = hydrateNeighbors ? expandedNodeIds : seedNodeIds;

  let chunks = [];
  if (opts.hydrate !== false) {
    const h = await hydrateChunksByNodeIds(env, hydrateNodeIds, {
      workspaceUuid,
      index_generation_id: activeGeneration.generationId,
    });
    if (h.ok) chunks = h.chunks;
  }

  // Fallback: if no chunk links yet, return symbol signatures as context snippets
  const results =
    chunks.length > 0
      ? chunks.map((c) => ({
          kind: 'chunk',
          node_id: c.node_id,
          file_path: c.file_path,
          content: c.content,
          chunk_index: c.chunk_index,
        }))
      : sym.hits.map((h) => ({
          kind: 'symbol',
          node_id: h.node_id,
          file_path: h.file_path,
          content: h.signature || `${h.node_type} ${h.node_name}`,
          score: h.score,
        }));

  return {
    ok: true,
    query: q,
    route: 'semantic_pgvector',
    query_intent: 'semantic',
    classify_reason:
      classified.route === 'structural' ? 'escalated_from_structural' : classified.reason,
    escalated_from: classified.route === 'structural' ? 'structural_d1' : null,
    index_generation_id: activeGeneration.generationId,
    revision_sha: activeGeneration.revisionSha,
    symbol_hits: sym.hits,
    expanded_node_ids: expandedNodeIds,
    hydrate_node_ids: hydrateNodeIds,
    hydrate_neighbors: hydrateNeighbors,
    edge_count: edges.length,
    edges,
    neighbors,
    direction_applied,
    edge_types_applied,
    results,
    result_count: results.length,
    duration_ms: Date.now() - t0,
    embed: sym.embed || null,
    note:
      chunks.length === 0
        ? 'No chunk node_id links yet — returning symbol signatures. Run Phase 2 chunk 3 --commit.'
        : hydrateNeighbors
          ? null
          : 'hydrate_seeds_only — neighbor chunks omitted (pass hydrate_neighbors:true to include)',
  };
}
