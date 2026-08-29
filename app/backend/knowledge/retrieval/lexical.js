import { estimateTokens, tokenizeText } from './math.js';
import { buildActiveScopeSql } from './code-index-scope.js';

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'where', 'what', 'when', 'why', 'how', 'does', 'this', 'that', 'into', 'are', 'was']);

function termsForQuery(query) {
  return tokenizeText(query).filter((token) => token.length >= 3 && !STOP.has(token)).slice(0, 10);
}

function lexicalScore(row, terms) {
  const name = String(row?.node_name || '').toLowerCase();
  const signature = String(row?.signature || '').toLowerCase();
  const path = String(row?.file_path || '').toLowerCase();
  const haystack = `${name} ${signature} ${path}`;
  let covered = 0;
  let exact = 0;
  for (const term of terms) {
    if (haystack.includes(term)) covered += 1;
    if (name === term) exact += 1;
  }
  if (!covered) return 0;
  const coverage = covered / Math.max(1, terms.length);
  return Math.min(1, coverage * 0.72 + Math.min(0.28, exact * 0.28));
}

function toCandidate(row, score, revisionSha) {
  const signature = String(row.signature || '').trim();
  const filePath = String(row.file_path || '');
  const nodeName = String(row.node_name || '');
  const text = [
    `File: ${filePath}`,
    `Symbol: ${nodeName || 'anonymous'}`,
    signature ? `Signature: ${signature}` : '',
    Number(row.line_start) ? `Lines: ${Number(row.line_start)}${Number(row.line_end) && Number(row.line_end) !== Number(row.line_start) ? `-${Number(row.line_end)}` : ''}` : '',
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
    lineStart: Number(row.line_start) || null,
    lineEnd: Number(row.line_end) || null,
    text,
    tokenCount: estimateTokens(text),
    score,
    retrievalScore: score,
    provenance: ['lexical_ast'],
  };
}

/** Lightweight exact/identifier retrieval over the canonical AST index. */
export async function searchLexicalAst({ env, workspaceId, query, scopes, candidateK = 24 }) {
  if (!env?.DB) return { ok: false, backend: 'lexical_ast', error: 'code_index_db_unavailable', hits: [] };
  if (!String(workspaceId || '').trim()) return { ok: false, backend: 'lexical_ast', error: 'workspace_id_required', hits: [] };
  if (!Array.isArray(scopes) || !scopes.length) return { ok: false, backend: 'lexical_ast', error: 'active_code_indexes_missing', hits: [] };
  const terms = termsForQuery(query);
  if (!terms.length) return { ok: true, backend: 'lexical_ast', hits: [] };

  const params = [];
  const scopeSql = buildActiveScopeSql(scopes, params);
  const clauses = [];
  for (const term of terms) {
    const like = `%${term}%`;
    clauses.push(`(LOWER(COALESCE(node_name,'')) LIKE ? OR LOWER(COALESCE(signature,'')) LIKE ? OR LOWER(COALESCE(file_path,'')) LIKE ?)`);
    params.push(like, like, like);
  }
  const limit = Math.max(4, Math.min(100, Math.round(Number(candidateK) || 24)));
  params.push(Math.min(240, limit * 4));

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, repo_full_name, index_generation_id, file_path, node_type, node_name,
              signature, line_start, line_end, updated_at
         FROM codebase_ast_nodes
        WHERE workspace_id = ?
          AND (${scopeSql})
          AND (${clauses.join(' OR ')})
        ORDER BY updated_at DESC
        LIMIT ?`,
    ).bind(String(workspaceId), ...params).all();
    const revisions = new Map(scopes.map((scope) => [`${scope.repoFullName}\u0000${scope.generationId}`, scope.revisionSha]));
    const hits = (results || [])
      .map((row) => toCandidate(
        row,
        lexicalScore(row, terms),
        revisions.get(`${row.repo_full_name}\u0000${row.index_generation_id}`) || null,
      ))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return { ok: true, backend: 'lexical_ast', hits };
  } catch (error) {
    return { ok: false, backend: 'lexical_ast', error: `lexical_ast_failed:${String(error?.message || error).slice(0, 180)}`, hits: [] };
  }
}

export { termsForQuery };
