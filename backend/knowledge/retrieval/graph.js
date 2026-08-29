import { clamp, estimateTokens } from './math.js';
import { buildActiveScopeSql } from './code-index-scope.js';

const ALLOWED_EDGE_TYPES = new Set(['calls', 'imports', 're_exports']);

function normalizeEdgeTypes(values) {
  const raw = Array.isArray(values) && values.length ? values : ['calls', 'imports', 're_exports'];
  return [...new Set(raw.map((value) => String(value || '').trim().toLowerCase()).filter((value) => ALLOWED_EDGE_TYPES.has(value)))];
}

function graphScore(seedScore, edgeType) {
  const bonus = edgeType === 'calls' ? 0.08 : edgeType === 'imports' ? 0.04 : 0.02;
  return clamp((Number(seedScore) || 0) * 0.62 + bonus, 0, 1);
}

function nodeToCandidate(row, relation) {
  const filePath = String(row.file_path || '');
  const nodeName = String(row.node_name || '');
  const signature = String(row.signature || '').trim();
  const docstring = String(row.docstring || '').trim();
  const lineStart = Number(row.line_start) || null;
  const lineEnd = Number(row.line_end) || null;
  const text = [
    `File: ${filePath}`,
    `Symbol: ${nodeName || 'anonymous'}`,
    `Type: ${String(row.node_type || 'symbol')}`,
    signature ? `Signature: ${signature}` : '',
    docstring ? `Documentation: ${docstring.slice(0, 1800)}` : '',
    `Graph: ${relation.edgeType} · 1 hop from ${relation.seedId}`,
    lineStart ? `Lines: ${lineStart}${lineEnd && lineEnd !== lineStart ? `-${lineEnd}` : ''}` : '',
  ].filter(Boolean).join('\n');
  return {
    id: `ast:${String(row.id)}`,
    sourceId: String(row.id),
    sourceType: 'code_symbol',
    repoFullName: String(row.repo_full_name || ''),
    revisionSha: relation.revisionSha || null,
    filePath,
    nodeType: String(row.node_type || ''),
    symbolName: nodeName || null,
    signature: signature || null,
    lineStart,
    lineEnd,
    text,
    tokenCount: estimateTokens(text),
    score: relation.score,
    retrievalScore: relation.score,
    graphDistance: 1,
    graphEdgeTypes: relation.edgeTypes,
    provenance: ['ast_graph'],
  };
}

/** One-hop expansion over the canonical D1 call/import graph for active index generations. */
export async function expandAstGraph({ env, workspaceId, scopes, seeds, edgeTypes, limit = 24 }) {
  if (!env?.DB) return { ok: false, backend: 'ast_graph', error: 'code_index_db_unavailable', hits: [] };
  if (!String(workspaceId || '').trim()) return { ok: false, backend: 'ast_graph', error: 'workspace_id_required', hits: [] };
  if (!Array.isArray(scopes) || !scopes.length) return { ok: false, backend: 'ast_graph', error: 'active_code_indexes_missing', hits: [] };

  const seedRows = (Array.isArray(seeds) ? seeds : [])
    .filter((row) => row?.sourceType === 'code_symbol' && row?.sourceId)
    .slice(0, 12);
  if (!seedRows.length) return { ok: true, backend: 'ast_graph', hits: [] };
  const seedScores = new Map(seedRows.map((row) => [String(row.sourceId), Number(row.score) || 0]));
  const seedIds = [...seedScores.keys()];
  const types = normalizeEdgeTypes(edgeTypes);
  if (!types.length) return { ok: true, backend: 'ast_graph', hits: [] };

  try {
    const edgeParams = [];
    const edgeScopeSql = buildActiveScopeSql(scopes, edgeParams);
    edgeParams.push(...types, ...seedIds, ...seedIds, Math.min(240, Math.max(24, Number(limit) * 8)));
    const placeholders = seedIds.map(() => '?').join(',');
    const typePlaceholders = types.map(() => '?').join(',');
    const { results: edgeRows } = await env.DB.prepare(
      `SELECT source_node_id, target_node_id, edge_type, repo_full_name, index_generation_id
         FROM codebase_dep_edges
        WHERE workspace_id = ?
          AND (${edgeScopeSql})
          AND COALESCE(is_external, 0) = 0
          AND edge_type IN (${typePlaceholders})
          AND (source_node_id IN (${placeholders}) OR target_node_id IN (${placeholders}))
        LIMIT ?`,
    ).bind(String(workspaceId), ...edgeParams).all();

    const relations = new Map();
    const revisionByScope = new Map(scopes.map((scope) => [`${scope.repoFullName}\u0000${scope.generationId}`, scope.revisionSha]));
    for (const edge of edgeRows || []) {
      const sourceId = String(edge.source_node_id || '');
      const targetId = String(edge.target_node_id || '');
      const type = String(edge.edge_type || '');
      let seedId = '';
      let neighborId = '';
      if (seedScores.has(sourceId) && targetId) {
        seedId = sourceId;
        neighborId = targetId;
      } else if (seedScores.has(targetId) && sourceId) {
        seedId = targetId;
        neighborId = sourceId;
      }
      if (!seedId || !neighborId || seedScores.has(neighborId)) continue;
      const score = graphScore(seedScores.get(seedId), type);
      const current = relations.get(neighborId);
      const edgeTypesSet = new Set(current?.edgeTypes || []);
      edgeTypesSet.add(type);
      relations.set(neighborId, {
        seedId: current && current.score >= score ? current.seedId : seedId,
        edgeType: current && current.score >= score ? current.edgeType : type,
        edgeTypes: [...edgeTypesSet],
        score: Math.max(current?.score || 0, score),
        revisionSha: revisionByScope.get(`${edge.repo_full_name}\u0000${edge.index_generation_id}`) || null,
      });
    }

    const neighborIds = [...relations.keys()].slice(0, Math.min(80, Math.max(8, Number(limit) * 3)));
    if (!neighborIds.length) return { ok: true, backend: 'ast_graph', hits: [] };

    const nodeParams = [];
    const nodeScopeSql = buildActiveScopeSql(scopes, nodeParams);
    const idPlaceholders = neighborIds.map(() => '?').join(',');
    nodeParams.push(...neighborIds);
    const { results: nodes } = await env.DB.prepare(
      `SELECT id, repo_full_name, index_generation_id, file_path, node_type, node_name,
              signature, docstring, line_start, line_end
         FROM codebase_ast_nodes
        WHERE workspace_id = ?
          AND (${nodeScopeSql})
          AND id IN (${idPlaceholders})`,
    ).bind(String(workspaceId), ...nodeParams).all();

    const hits = (nodes || [])
      .map((row) => nodeToCandidate(row, relations.get(String(row.id))))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(64, Number(limit) || 24)));
    return { ok: true, backend: 'ast_graph', hits };
  } catch (error) {
    return { ok: false, backend: 'ast_graph', error: `ast_graph_failed:${String(error?.message || error).slice(0, 180)}`, hits: [] };
  }
}
