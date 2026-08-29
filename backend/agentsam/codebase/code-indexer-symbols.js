/**
 * Code indexer — AST node/symbol persistence, relink, embed stamps, symbol upsert.
 */
import { runCodeIndexPgQuery, runCodeIndexPgSession } from './code-index-write-pipe.js';
import {
  resolveCodeIndexLaneConfig,
  requireCodeIndexLaneConfig,
} from './code-index-lane-resolve.js';
import { STRUCTURAL_PARSER_ID, FULL_INDEX_PIPELINE } from './codebase-full-index.js';
import { deleteDepEdgesForFile } from './codebase-dep-edges.js';
import { vectorLiteral } from './code-indexer-shared.js';
import { normalizeCodeIndexGenerationId } from './code-index-generation.js';

function upsertSymbolSql(symbolsTable) {
  return `INSERT INTO agentsam.${symbolsTable} (
       node_id, workspace_id, repo_full_name, file_path, node_type, node_name, signature,
       line_start, line_end, content, embedding, metadata, index_generation_id, updated_at
     ) VALUES (
       $1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector, $12::jsonb, $13, now()
     )
     ON CONFLICT (index_generation_id, node_id) DO UPDATE SET
       workspace_id = EXCLUDED.workspace_id,
       repo_full_name = EXCLUDED.repo_full_name,
       file_path = EXCLUDED.file_path,
       node_type = EXCLUDED.node_type,
       node_name = EXCLUDED.node_name,
       signature = EXCLUDED.signature,
       line_start = EXCLUDED.line_start,
       line_end = EXCLUDED.line_end,
       content = EXCLUDED.content,
       embedding = EXCLUDED.embedding,
       metadata = EXCLUDED.metadata,
       updated_at = now()`;
}

function symbolUpsertParams(node, workspaceUuid, embedding, runId) {
  const content = symbolEmbedText(node);
  const generationId = normalizeCodeIndexGenerationId(node.index_generation_id);
  if (!generationId) {
    throw new Error(`symbol_upsert_generation_required:${node.id || '?'}`);
  }
  return [
    node.id,
    workspaceUuid,
    node.repo_full_name || node.repoFullName,
    node.file_path,
    node.node_type,
    node.node_name,
    node.signature || null,
    Number(node.line_start) || null,
    Number(node.line_end) || null,
    content,
    vectorLiteral(embedding),
    JSON.stringify({
      run_id: runId,
      pipeline: FULL_INDEX_PIPELINE,
      index_generation_id: generationId,
      revision_sha: node.revision_sha || null,
      file_hash: node.file_hash || null,
      parser_id: node.parser_id || STRUCTURAL_PARSER_ID,
      structural_quality: node.structural_quality || 'treesitter',
      source: 'codebase_full_index',
    }),
    generationId,
  ];
}

export function symbolEmbedText(node) {
  return [
    `repo:${node.repo_full_name || node.repoFullName || ''}`,
    `revision:${node.revision_sha || ''}`,
    `file:${node.file_path || ''}`,
    `type:${node.node_type || ''}`,
    `name:${node.node_name || ''}`,
    String(node.signature || node.node_name || ''),
  ]
    .join(' | ')
    .slice(0, 4000);
}

export async function deleteFullFileArtifacts(
  env,
  workspaceUuid,
  workspaceId,
  repoFullName,
  filePath,
  opts = {},
) {
  await resolveCodeIndexLaneConfig(env);
  const { chunks: chunksTable, symbols: symbolsTable } = requireCodeIndexLaneConfig(env).tables;
  const generationId = normalizeCodeIndexGenerationId(opts.indexGenerationId ?? opts.index_generation_id);
  if (!generationId) {
    throw new Error('delete_full_file_artifacts_generation_required');
  }
  await deleteDepEdgesForFile(env, workspaceId, repoFullName, filePath, {
    indexGenerationId: generationId,
  });
  await env.DB.prepare(
    `DELETE FROM codebase_ast_nodes
      WHERE workspace_id = ? AND repo_full_name = ? AND file_path = ?
        AND index_generation_id = ?`,
  )
    .bind(workspaceId, repoFullName, filePath, generationId)
    .run();
  const pgOpts = opts.client ? { client: opts.client } : {};
  const session = await runCodeIndexPgSession(
    env,
    async (client) => {
      await client.query(
        `DELETE FROM agentsam.${chunksTable}
          WHERE workspace_id = $1::uuid AND file_path = $2
            AND index_generation_id = $3
            AND COALESCE(metadata->>'repo_full_name', '') = $4`,
        [workspaceUuid, filePath, generationId, repoFullName],
      );
      await client.query(
        `DELETE FROM agentsam.${symbolsTable}
          WHERE workspace_id = $1::uuid AND repo_full_name = $2 AND file_path = $3
            AND index_generation_id = $4`,
        [workspaceUuid, repoFullName, filePath, generationId],
      );
      return { rows: [] };
    },
    pgOpts,
  );
  if (!session.ok) throw new Error(session.error || 'file_artifact_delete_failed');
}

export async function findIndexedGitBlobSha(env, workspaceUuid, repoFullName, filePath, opts = {}) {
  await resolveCodeIndexLaneConfig(env);
  const chunksTable = requireCodeIndexLaneConfig(env).tables.chunks;
  const pg = await runCodeIndexPgQuery(
    env,
    `SELECT metadata->>'git_blob_sha' AS git_blob_sha,
            metadata->>'parser_id' AS parser_id
       FROM agentsam.${chunksTable}
      WHERE workspace_id = $1::uuid
        AND file_path = $2
        AND COALESCE(metadata->>'repo_full_name', '') = $3
        AND COALESCE(metadata->>'git_blob_sha', '') <> ''
      LIMIT 1`,
    [workspaceUuid, filePath, repoFullName],
    opts,
  );
  if (!pg.ok) return { git_blob_sha: null, parser_id: null };
  const sha = pg.rows?.[0]?.git_blob_sha;
  const parserId = pg.rows?.[0]?.parser_id;
  return {
    git_blob_sha: sha != null && String(sha).trim() ? String(sha).trim() : null,
    parser_id: parserId != null && String(parserId).trim() ? String(parserId).trim() : null,
  };
}

export async function countPgArtifactsForFile(env, workspaceUuid, repoFullName, filePath, opts = {}) {
  await resolveCodeIndexLaneConfig(env);
  const { chunks: chunksTable, symbols: symbolsTable } = requireCodeIndexLaneConfig(env).tables;
  const chunks = await runCodeIndexPgQuery(
    env,
    `SELECT COUNT(*)::int AS c FROM agentsam.${chunksTable}
      WHERE workspace_id = $1::uuid AND file_path = $2
        AND COALESCE(metadata->>'repo_full_name', '') = $3`,
    [workspaceUuid, filePath, repoFullName],
    opts,
  );
  const symbols = await runCodeIndexPgQuery(
    env,
    `SELECT COUNT(*)::int AS c FROM agentsam.${symbolsTable}
      WHERE workspace_id = $1::uuid AND repo_full_name = $2 AND file_path = $3`,
    [workspaceUuid, repoFullName, filePath],
    opts,
  );
  return {
    chunks: Number(chunks.ok ? chunks.rows?.[0]?.c : 0) || 0,
    symbols: Number(symbols.ok ? symbols.rows?.[0]?.c : 0) || 0,
  };
}

export async function relinkPgArtifactsToJob(env, workspaceUuid, repoFullName, filePath, jobId, opts = {}) {
  await resolveCodeIndexLaneConfig(env);
  const { chunks: chunksTable, symbols: symbolsTable } = requireCodeIndexLaneConfig(env).tables;
  const runId = String(jobId || '').trim();
  if (!runId) return;
  const chunks = await runCodeIndexPgQuery(
    env,
    `UPDATE agentsam.${chunksTable}
        SET metadata = jsonb_set(
              COALESCE(metadata, '{}'::jsonb),
              '{run_id}',
              to_jsonb($4::text),
              true
            )
      WHERE workspace_id = $1::uuid
        AND file_path = $2
        AND COALESCE(metadata->>'repo_full_name', '') = $3`,
    [workspaceUuid, filePath, repoFullName, runId],
    opts,
  );
  if (!chunks.ok) throw new Error(chunks.error || 'chunk_run_id_relink_failed');
  const symbols = await runCodeIndexPgQuery(
    env,
    `UPDATE agentsam.${symbolsTable}
        SET metadata = jsonb_set(
              COALESCE(metadata, '{}'::jsonb),
              '{run_id}',
              to_jsonb($4::text),
              true
            ),
            updated_at = now()
      WHERE workspace_id = $1::uuid AND repo_full_name = $2 AND file_path = $3`,
    [workspaceUuid, repoFullName, filePath, runId],
    opts,
  );
  if (!symbols.ok) throw new Error(symbols.error || 'symbol_run_id_relink_failed');
}

export async function relinkNodesToJob(env, workspaceId, repoFullName, filePath, jobId) {
  await env.DB.prepare(
    `UPDATE codebase_ast_nodes
        SET index_job_id = ?, updated_at = unixepoch()
      WHERE workspace_id = ? AND repo_full_name = ? AND file_path = ?`,
  )
    .bind(jobId, workspaceId, repoFullName, filePath)
    .run()
    .catch(() => null);
}

export async function symbolAlreadyEmbedded(env, nodeId, nodeRow = null) {
  if (nodeRow && Object.prototype.hasOwnProperty.call(nodeRow, 'embedded_at')) {
    const hint = nodeRow.embedded_at;
    return hint != null && Number(hint) > 0;
  }
  const id = nodeId != null ? String(nodeId).trim() : '';
  if (!id || !env?.DB) return false;
  const row = await env.DB.prepare(
    `SELECT embedded_at FROM codebase_ast_nodes WHERE id = ? LIMIT 1`,
  )
    .bind(id)
    .first()
    .catch(() => null);
  return row?.embedded_at != null && Number(row.embedded_at) > 0;
}

export async function markSymbolEmbeddedInD1(env, nodeId) {
  const id = nodeId != null ? String(nodeId).trim() : '';
  if (!id || !env?.DB) return;
  try {
    await env.DB.prepare(
      `UPDATE codebase_ast_nodes
          SET embedded_at = unixepoch(), updated_at = unixepoch()
        WHERE id = ?`,
    )
      .bind(id)
      .run();
  } catch (err) {
    throw new Error(
      `symbol_embedded_at_stamp_failed:${id}:${String(err?.message || err).slice(0, 160)}`,
    );
  }
}

export async function clearSymbolEmbeddedInD1(env, nodeId) {
  const id = nodeId != null ? String(nodeId).trim() : '';
  if (!id || !env?.DB) return;
  await env.DB.prepare(
    `UPDATE codebase_ast_nodes
        SET embedded_at = NULL, updated_at = unixepoch()
      WHERE id = ?`,
  )
    .bind(id)
    .run()
    .catch(() => null);
}

export async function hydrateEmbeddedAtFromPg(env, nodes, opts = {}) {
  await resolveCodeIndexLaneConfig(env);
  const symbolsTable = requireCodeIndexLaneConfig(env).tables.symbols;
  const list = Array.isArray(nodes) ? nodes : [];
  const unmarked = list.filter(
    (n) =>
      n?.id &&
      !(Object.prototype.hasOwnProperty.call(n, 'embedded_at')
        ? n.embedded_at != null && Number(n.embedded_at) > 0
        : false),
  );
  if (!unmarked.length) return;
  const ids = unmarked.map((n) => String(n.id));
  const pg = await runCodeIndexPgQuery(
    env,
    `SELECT node_id FROM agentsam.${symbolsTable}
      WHERE node_id = ANY($1::text[])`,
    [ids],
    opts,
  );
  if (!pg?.ok) return;
  const found = new Set(
    (pg.rows || [])
      .map((r) => (r?.node_id != null ? String(r.node_id) : ''))
      .filter(Boolean),
  );
  if (!found.size) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const toMark = ids.filter((id) => found.has(id));
  for (let offset = 0; offset < toMark.length; offset += 50) {
    const chunk = toMark.slice(offset, offset + 50);
    const stmts = chunk.map((id) =>
      env.DB.prepare(
        `UPDATE codebase_ast_nodes
            SET embedded_at = ?, updated_at = unixepoch()
          WHERE id = ? AND (embedded_at IS NULL OR embedded_at = 0)`,
      ).bind(nowSec, id),
    );
    await env.DB.batch(stmts).catch(() => null);
  }
  for (const node of list) {
    if (node?.id && found.has(String(node.id))) node.embedded_at = nowSec;
  }
}

export async function stampSymbolRunId(env, nodeId, workspaceUuid, runId) {
  const stamped = await stampSymbolRunIdsBatch(env, [nodeId], workspaceUuid, runId);
  return stamped.has(String(nodeId || '').trim());
}

/**
 * Stamp run_id on many existing PG symbol rows (pass `{ client }` from batch).
 * @returns {Promise<Set<string>>} node_ids that existed and were stamped
 */
export async function stampSymbolRunIdsBatch(env, nodeIds, workspaceUuid, runId, opts = {}) {
  await resolveCodeIndexLaneConfig(env);
  const symbolsTable = requireCodeIndexLaneConfig(env).tables.symbols;
  const rid = String(runId || '').trim();
  const ws = String(workspaceUuid || '').trim();
  const ids = [...new Set((Array.isArray(nodeIds) ? nodeIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
  const stamped = new Set();
  if (!ids.length || !rid || !ws) return stamped;

  const session = await runCodeIndexPgSession(env, async (client) => {
    // Chunk ANY() binds — keep under practical param limits.
    for (let offset = 0; offset < ids.length; offset += 80) {
      const chunk = ids.slice(offset, offset + 80);
      const r = await client.query(
        `UPDATE agentsam.${symbolsTable}
            SET metadata = jsonb_set(
                  COALESCE(metadata, '{}'::jsonb),
                  '{run_id}',
                  to_jsonb($2::text),
                  true
                ),
                updated_at = now()
          WHERE workspace_id = $3::uuid
            AND node_id = ANY($1::text[])
          RETURNING node_id`,
        [chunk, rid, ws],
      );
      for (const row of r?.rows || []) {
        if (row?.node_id != null) stamped.add(String(row.node_id));
      }
    }
    return { rows: [...stamped].map((node_id) => ({ node_id })) };
  }, opts);
  if (!session.ok) throw new Error(session.error || 'symbol_run_id_stamp_batch_failed');
  return stamped;
}

export async function insertFullNodes(env, symbols) {
  if (!symbols.length) return 0;

  // Same-generation re-parse / retry must not collide with rows from a prior attempt
  // on this job (UNIQUE includes generation after migration 1264).
  /** @type {Map<string, { workspaceId: string, repoFullName: string, filePath: string, generationId: string }>} */
  const fileKeys = new Map();
  for (const node of symbols) {
    const workspaceId = String(node.workspace_id || '').trim();
    const repoFullName = String(node.repo_full_name || node.repoFullName || '').trim();
    const filePath = String(node.file_path || '').trim();
    const generationId = normalizeCodeIndexGenerationId(node.index_generation_id);
    if (!workspaceId || !repoFullName || !filePath || !generationId) continue;
    const key = `${workspaceId}\0${repoFullName}\0${filePath}\0${generationId}`;
    if (!fileKeys.has(key)) {
      fileKeys.set(key, { workspaceId, repoFullName, filePath, generationId });
    }
  }
  for (const entry of fileKeys.values()) {
    await env.DB.prepare(
      `DELETE FROM codebase_ast_nodes
        WHERE workspace_id = ? AND repo_full_name = ? AND file_path = ?
          AND index_generation_id = ?`,
    )
      .bind(entry.workspaceId, entry.repoFullName, entry.filePath, entry.generationId)
      .run()
      .catch(() => null);
  }

  let inserted = 0;
  for (let offset = 0; offset < symbols.length; offset += 50) {
    const slice = symbols.slice(offset, offset + 50);
    const statements = slice.map((node) => {
      const repoFullName = String(node.repo_full_name || node.repoFullName || '').trim();
      const workspaceId = String(node.workspace_id || '').trim();
      if (!workspaceId || !repoFullName || !node.id || !node.file_path || !node.node_name || !node.node_type) {
        throw new Error(
          `ast_node_insert_invalid:${node.file_path || '?'}|${node.node_name || '?'}|missing_required`,
        );
      }
      return env.DB.prepare(
        `INSERT INTO codebase_ast_nodes (
           id, workspace_id, repo_full_name, file_path, node_type, node_name, signature, docstring,
           line_start, line_end, is_exported, is_default_export, language, file_hash,
           index_job_id, index_generation_id, parser_id, revision_sha, git_blob_sha, structural_quality,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())`,
      ).bind(
        node.id,
        workspaceId,
        repoFullName,
        node.file_path,
        node.node_type,
        node.node_name,
        node.signature || null,
        node.docstring || null,
        node.line_start,
        node.line_end,
        node.is_exported || 0,
        node.is_default_export || 0,
        node.language,
        node.file_hash || null,
        node.index_job_id,
        (() => {
          const g = normalizeCodeIndexGenerationId(node.index_generation_id);
          if (!g) {
            throw new Error(
              `ast_node_insert_generation_required:${node.file_path || '?'}|${node.node_name || '?'}`,
            );
          }
          return g;
        })(),
        node.parser_id || STRUCTURAL_PARSER_ID || null,
        node.revision_sha || null,
        node.git_blob_sha || null,
        node.structural_quality || null,
      );
    });
    const results = await env.DB.batch(statements);
    for (let i = 0; i < results.length; i += 1) {
      const r = results[i];
      if (r?.success === false || r?.error) {
        const sample = slice[i];
        throw new Error(
          `ast_node_insert_failed:${sample?.file_path || '?'}|${sample?.node_name || '?'}|${String(r.error || 'batch').slice(0, 200)}`,
        );
      }
      inserted += Number(r?.meta?.changes ?? 1) || 0;
    }
  }
  return inserted;
}

export async function upsertFullSymbolRow(env, node, workspaceUuid, embedding, runId) {
  await upsertFullSymbolRowsBatch(env, [{ node, embedding }], workspaceUuid, runId);
}

/**
 * Many symbol upserts on one session-pooler client (pass `{ client }` from batch).
 * Then stamps D1 embedded_at in a single batch — never mirrors vectors into D1.
 *
 * @param {any} env
 * @param {Array<{ node: object, embedding: number[] }>} items
 * @param {string} workspaceUuid
 * @param {string} runId
 * @param {{ client?: any }} [opts]
 */
export async function upsertFullSymbolRowsBatch(env, items, workspaceUuid, runId, opts = {}) {
  await resolveCodeIndexLaneConfig(env);
  const symbolsTable = requireCodeIndexLaneConfig(env).tables.symbols;
  const sql = upsertSymbolSql(symbolsTable);
  const list = Array.isArray(items) ? items.filter((it) => it?.node?.id && it?.embedding) : [];
  if (!list.length) return { ok: true, upserted: 0 };

  const session = await runCodeIndexPgSession(env, async (client) => {
    let upserted = 0;
    for (const { node, embedding } of list) {
      await client.query(
        sql,
        symbolUpsertParams(node, workspaceUuid, embedding, runId),
      );
      upserted += 1;
    }
    return { upserted, rows: [] };
  }, opts);
  if (!session.ok) throw new Error(session.error || 'full_symbol_upsert_batch_failed');

  const nowSec = Math.floor(Date.now() / 1000);
  for (let offset = 0; offset < list.length; offset += 50) {
    const slice = list.slice(offset, offset + 50);
    const stmts = slice.map(({ node }) =>
      env.DB.prepare(
        `UPDATE codebase_ast_nodes
            SET embedded_at = ?, updated_at = unixepoch()
          WHERE id = ?`,
      ).bind(nowSec, node.id),
    );
    await env.DB.batch(stmts);
  }
  return { ok: true, upserted: Number(session.result?.upserted) || list.length };
}
