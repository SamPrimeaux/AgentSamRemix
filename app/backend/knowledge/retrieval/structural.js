import { estimateTokens, tokenizeText } from './math.js';
import { buildActiveScopeSql } from './code-index-scope.js';

function searchNeedles(query) {
  const raw = String(query || '');
  const codeTokens = raw.match(/[A-Za-z_$][A-Za-z0-9_$.-]{2,}/g) || [];
  const general = tokenizeText(raw).filter((token) => token.length >= 3);
  return [...new Set([...codeTokens, ...general])].slice(0, 8);
}

function normalizedNodeTypes(nodeTypes) {
  return (Array.isArray(nodeTypes) ? nodeTypes : [])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => /^[a-z0-9_:-]{1,64}$/.test(value))
    .slice(0, 12);
}

function scoreRow(row, needles) {
  const name = String(row?.node_name || '').toLowerCase();
  const signature = String(row?.signature || '').toLowerCase();
  const path = String(row?.file_path || '').toLowerCase();
  let score = 0;
  let matched = 0;
  for (const needleRaw of needles) {
    const needle = needleRaw.toLowerCase();
    let local = 0;
    if (name === needle) local = 1;
    else if (name.includes(needle)) local = 0.88;
    else if (signature.includes(needle)) local = 0.72;
    else if (path.includes(needle)) local = 0.52;
    if (local > 0) matched += 1;
    score = Math.max(score, local);
  }
  if (needles.length > 1) score += Math.min(0.18, (matched / needles.length) * 0.18);
  return Math.min(1, score);
}

function toCandidate(row, score, revisionSha) {
  const filePath = String(row.file_path || '');
  const nodeName = String(row.node_name || '');
  const signature = String(row.signature || '').trim();
  const lineStart = Number(row.line_start) || null;
  const lineEnd = Number(row.line_end) || null;
  const text = [
    `File: ${filePath}`,
    `Symbol: ${nodeName || 'anonymous'}`,
    `Type: ${String(row.node_type || 'symbol')}`,
    signature ? `Signature: ${signature}` : '',
    lineStart ? `Lines: ${lineStart}${lineEnd && lineEnd !== lineStart ? `-${lineEnd}` : ''}` : '',
  ].filter(Boolean).join('\n');
  return {
    id: `ast:${String(row.id)}`,
    sourceId: String(row.id),
    sourceType: 'code_symbol',
    repoFullName: String(row.repo_full_name || ''),
    revisionSha: revisionSha || null,
    filePath,
    nodeType: String(row.node_type || ''),
    symbolName: nodeName || null,
    signature: signature || null,
    lineStart,
    lineEnd,
    text,
    tokenCount: estimateTokens(text),
    score,
    retrievalScore: score,
    provenance: ['ast_structural'],
  };
}

export async function searchStructuralAst({ env, workspaceId, query, scopes, candidateK = 24, nodeTypes = [] }) {
  if (!env?.DB) return { ok: false, backend: 'ast_structural', error: 'code_index_db_unavailable', hits: [] };
  if (!String(workspaceId || '').trim()) return { ok: false, backend: 'ast_structural', error: 'workspace_id_required', hits: [] };
  if (!Array.isArray(scopes) || !scopes.length) return { ok: false, backend: 'ast_structural', error: 'active_code_indexes_missing', hits: [] };
  const needles = searchNeedles(query);
  if (!needles.length) return { ok: true, backend: 'ast_structural', hits: [] };

  const params = [];
  const scopeSql = buildActiveScopeSql(scopes, params);
  const needleClauses = [];
  for (const raw of needles) {
    const like = `%${String(raw).toLowerCase()}%`;
    needleClauses.push(`(LOWER(COALESCE(node_name,'')) LIKE ? OR LOWER(COALESCE(signature,'')) LIKE ? OR LOWER(COALESCE(file_path,'')) LIKE ?)`);
    params.push(like, like, like);
  }
  const types = normalizedNodeTypes(nodeTypes);
  let typeSql = '';
  if (types.length) {
    typeSql = ` AND LOWER(COALESCE(node_type,'')) IN (${types.map(() => '?').join(',')})`;
    params.push(...types);
  }
  const limit = Math.max(4, Math.min(100, Math.round(Number(candidateK) || 24)));
  params.push(Math.min(200, limit * 3));

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, repo_full_name, index_generation_id, file_path, node_type, node_name,
              signature, line_start, line_end, updated_at
         FROM codebase_ast_nodes
        WHERE workspace_id = ?
          AND (${scopeSql})
          AND (${needleClauses.join(' OR ')})${typeSql}
        ORDER BY updated_at DESC
        LIMIT ?`,
    ).bind(String(workspaceId), ...params).all();

    const revisions = new Map(scopes.map((scope) => [`${scope.repoFullName}\u0000${scope.generationId}`, scope.revisionSha]));
    const hits = (results || [])
      .map((row) => {
        const score = scoreRow(row, needles);
        const revision = revisions.get(`${row.repo_full_name}\u0000${row.index_generation_id}`) || null;
        return toCandidate(row, score, revision);
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return { ok: true, backend: 'ast_structural', hits };
  } catch (error) {
    return { ok: false, backend: 'ast_structural', error: `ast_structural_failed:${String(error?.message || error).slice(0, 180)}`, hits: [] };
  }
}

export { searchNeedles };
