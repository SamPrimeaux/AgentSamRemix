/**
 * D1 one-hop AST graph expand (imports / calls / …).
 * Kept free of Hyperdrive / embedding imports so unit tests run without full node_modules.
 */

const DEFAULT_EDGE_TYPES = ['imports', 'calls', 'extends', 'uses_hook', 're_exports'];

/**
 * Normalize graph hop direction for expandAstGraph.
 * - out / callees / callees_of → seed is source (what does this call?)
 * - in / callers / callers_of → seed is target (who calls this?)
 * - both (default) → either side
 * @param {unknown} raw
 * @returns {'both'|'out'|'in'}
 */
export function normalizeGraphDirection(raw) {
  const v = String(raw ?? 'both')
    .toLowerCase()
    .trim();
  if (v === 'in' || v === 'callers' || v === 'callers_of' || v === 'caller') return 'in';
  if (v === 'out' || v === 'callees' || v === 'callees_of' || v === 'callee') return 'out';
  return 'both';
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeEdgeTypes(raw) {
  if (raw == null || raw === '') return [...DEFAULT_EDGE_TYPES];
  let list = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [...DEFAULT_EDGE_TYPES];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) list = parsed;
      else list = s.split(/[,|\s]+/);
    } catch {
      list = s.split(/[,|\s]+/);
    }
  }
  if (!Array.isArray(list)) return [...DEFAULT_EDGE_TYPES];
  const out = [
    ...new Set(
      list
        .map((x) => String(x || '').trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  return out.length ? out : [...DEFAULT_EDGE_TYPES];
}

/**
 * Expand D1 dependency edges one hop from seed node ids.
 * @param {object} env
 * @param {string[]} nodeIds
 * @param {{
 *   workspaceId?: string,
 *   edgeTypes?: string[]|string,
 *   edge_types?: string[]|string,
 *   direction?: string,
 *   graphDirection?: string,
 *   maxNodes?: number,
 * }} [opts]
 */
export async function expandAstGraph(env, nodeIds, opts = {}) {
  const db = env?.DB;
  if (!db) {
    return {
      ok: false,
      error: 'd1_unavailable',
      node_ids: nodeIds || [],
      edges: [],
      edge_count: 0,
      neighbors: [],
      direction_applied: null,
    };
  }
  const seeds = [...new Set((nodeIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
  const direction = normalizeGraphDirection(opts.direction ?? opts.graphDirection);
  const edgeTypes = normalizeEdgeTypes(opts.edgeTypes ?? opts.edge_types);
  if (!seeds.length) {
    return {
      ok: true,
      node_ids: [],
      edges: [],
      edge_count: 0,
      neighbors: [],
      seed_count: 0,
      direction_applied: direction,
      edge_types_applied: edgeTypes,
    };
  }

  const workspaceId =
    opts.workspaceId != null && String(opts.workspaceId).trim()
      ? String(opts.workspaceId).trim()
      : '';
  if (!workspaceId) {
    return {
      ok: false,
      error: 'workspace_id_required',
      node_ids: seeds,
      edges: [],
      edge_count: 0,
      neighbors: [],
      seed_count: seeds.length,
      direction_applied: null,
    };
  }
  const maxNodes = Math.min(Math.max(Number(opts.maxNodes) || 40, 1), 120);
  const generationId =
    opts.index_generation_id != null && String(opts.index_generation_id).trim()
      ? String(opts.index_generation_id).trim()
      : opts.indexGenerationId != null && String(opts.indexGenerationId).trim()
        ? String(opts.indexGenerationId).trim()
        : '';
  if (!generationId) {
    return {
      ok: false,
      error: 'index_generation_id_required',
      node_ids: seeds,
      edges: [],
      edge_count: 0,
      neighbors: [],
      seed_count: seeds.length,
      direction_applied: null,
    };
  }

  const phSeeds = seeds.map(() => '?').join(',');
  const phTypes = edgeTypes.map(() => '?').join(',');
  let hopClause;
  let binds;
  if (direction === 'out') {
    // Callees: seed is source → follow target_node_id
    hopClause = `source_node_id IN (${phSeeds})`;
    binds = [workspaceId, generationId, ...edgeTypes, ...seeds];
  } else if (direction === 'in') {
    // Callers: seed is target → follow source_node_id
    hopClause = `target_node_id IS NOT NULL AND target_node_id IN (${phSeeds})`;
    binds = [workspaceId, generationId, ...edgeTypes, ...seeds];
  } else {
    hopClause = `(
        source_node_id IN (${phSeeds})
        OR (target_node_id IS NOT NULL AND target_node_id IN (${phSeeds}))
      )`;
    binds = [workspaceId, generationId, ...edgeTypes, ...seeds, ...seeds];
  }

  const sql = `
    SELECT id, source_node_id, target_node_id, target_external, edge_type,
           source_file, target_file, is_external, repo_full_name
    FROM codebase_dep_edges
    WHERE workspace_id = ?
      AND index_generation_id = ?
      AND edge_type IN (${phTypes})
      AND ${hopClause}
    LIMIT 200
  `;
  const res = await db.prepare(sql).bind(...binds).all();
  const edges = (res?.results || []).map((e) => ({
    id: e.id,
    source_node_id: e.source_node_id,
    target_node_id: e.target_node_id,
    target_external: e.target_external ?? null,
    edge_type: e.edge_type,
    source_file: e.source_file,
    target_file: e.target_file,
    is_external: e.is_external,
    repo: e.repo_full_name || e.repo,
  }));

  const expanded = new Set(seeds);
  for (const e of edges) {
    if (e.source_node_id) expanded.add(e.source_node_id);
    if (e.target_node_id) expanded.add(e.target_node_id);
  }
  const node_ids = [...expanded].slice(0, maxNodes);

  const neighborIds = node_ids.filter((id) => !seeds.includes(id));
  let neighbors = [];
  if (neighborIds.length) {
    const phN = neighborIds.map(() => '?').join(',');
    const nSql = `
      SELECT id, node_type, node_name, file_path, repo_full_name, line_start, line_end
      FROM codebase_ast_nodes
      WHERE workspace_id = ?
        AND index_generation_id = ?
        AND id IN (${phN})
    `;
    try {
      const nRes = await db.prepare(nSql).bind(workspaceId, generationId, ...neighborIds).all();
      neighbors = (nRes?.results || []).map((n) => ({
        node_id: n.id,
        node_type: n.node_type,
        node_name: n.node_name,
        file_path: n.file_path,
        repo: n.repo_full_name || n.repo,
        line_start: n.line_start,
        line_end: n.line_end,
      }));
    } catch {
      // Edges still valid without node hydrate — fail soft on neighbor summary only
      neighbors = neighborIds.map((id) => {
        const e =
          edges.find((x) => x.source_node_id === id || x.target_node_id === id) || {};
        const fromSource = e.source_node_id === id;
        return {
          node_id: id,
          node_type: null,
          node_name: null,
          file_path: fromSource ? e.source_file || null : e.target_file || null,
          repo: e.repo_full_name || e.repo || null,
          line_start: null,
          line_end: null,
        };
      });
    }
  }

  return {
    ok: true,
    node_ids,
    edges,
    edge_count: edges.length,
    neighbors,
    seed_count: seeds.length,
    direction_applied: direction,
    edge_types_applied: edgeTypes,
    index_generation_id: generationId,
  };
}
