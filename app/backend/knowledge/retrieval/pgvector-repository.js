import { runHyperdriveQuery } from '../../services/database/hyperdrive.js';
import { resolveSemanticWorkspaceId } from './workspace-resolver.js';

const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/i;

function identifier(value, label) {
  const text = String(value || '').trim();
  if (!IDENTIFIER_RE.test(text)) throw new Error(`${label}_invalid`);
  return `"${text}"`;
}

function vectorLiteral(vector) {
  if (!Array.isArray(vector) || !vector.length) throw new Error('vector_required');
  if (!vector.every((value) => Number.isFinite(Number(value)))) throw new Error('vector_non_finite');
  return `[${vector.map((value) => Number(value)).join(',')}]`;
}

/**
 * ANN implementation backed by the existing Supabase pgvector code chunk lane.
 * One route maps to one physical embedding space/table; no cross-space scan.
 */
export function createPgvectorCodeRepository(env, resolveRoute) {
  return {
    async search({ vector, embeddingSpaceKey, routeKey, topK, scope }) {
      const route = await resolveRoute();
      if (route.routeKey !== routeKey) throw new Error('embedding_route_changed_during_query');
      if (route.embeddingSpaceKey !== embeddingSpaceKey) throw new Error('embedding_space_changed_during_query');
      if (vector.length !== route.dimensions) throw new Error(`embedding_dimensions_mismatch:${route.dimensions}:${vector.length}`);

      const workspaceUuid = await resolveSemanticWorkspaceId(env, scope?.workspaceId);
      if (!workspaceUuid) throw new Error('semantic_workspace_unresolved');
      const codeScopes = Array.isArray(scope?.codeScopes) ? scope.codeScopes : [];
      if (!codeScopes.length) return { hits: [] };

      const schema = identifier(route.schemaName, 'pgvector_schema');
      const table = identifier(route.tableName, 'pgvector_table');
      const literal = vectorLiteral(vector);
      const limit = Math.max(1, Math.min(100, Math.round(Number(topK) || 24)));
      const perScope = Math.max(4, Math.ceil(limit / codeScopes.length) + 4);
      const hits = [];

      for (const active of codeScopes) {
        const repoFullName = String(active?.repoFullName || '').trim();
        const generationId = String(active?.generationId || '').trim();
        if (!repoFullName || !generationId) continue;
        const sql = `
          SELECT id::text AS id, node_id, repo_full_name, file_path, chunk_index,
                 content, token_count,
                 1 - (embedding <=> $1::vector) AS score
            FROM ${schema}.${table}
           WHERE workspace_id = $2::uuid
             AND repo_full_name = $3
             AND index_generation_id = $4
             AND embedding IS NOT NULL
           ORDER BY embedding <=> $1::vector
           LIMIT $5`;
        const result = await runHyperdriveQuery(env, sql, [literal, workspaceUuid, repoFullName, generationId, perScope]);
        if (!result.ok) throw new Error(result.error || 'pgvector_query_failed');
        for (const row of result.rows || []) {
          hits.push({
            id: String(row.id),
            chunkId: String(row.id),
            sourceId: String(row.node_id || row.id),
            sourceType: 'code_chunk',
            repoFullName,
            revisionSha: active?.revisionSha || null,
            filePath: row.file_path || null,
            text: String(row.content || ''),
            tokenCount: Number(row.token_count) || 0,
            score: Number(row.score) || 0,
            embeddingSpaceKey,
            routeKey,
            provenance: ['pgvector_ann'],
          });
        }
      }

      hits.sort((a, b) => b.score - a.score);
      return { hits: hits.slice(0, limit) };
    },
  };
}
