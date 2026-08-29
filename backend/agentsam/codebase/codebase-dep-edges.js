/**
 * Worker full-index dep-edge writer (Gap A).
 * Builds codebase_dep_edges for a cidxrun_* job from structural import/re_export nodes.
 * Pure path resolve is unit-testable; D1 writes stay in insert/prune helpers.
 */

import { normalizeCodeIndexGenerationId, resolveJobIndexGenerationId } from './code-index-generation.js';

const RELATIVE_EXT_CANDIDATES = [
  '',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '/index.js',
  '/index.ts',
  '/index.tsx',
  '/index.jsx',
  '/index.mjs',
];

/**
 * Resolve a static import specifier against a set of repo-relative file paths.
 * @param {string} source raw module specifier
 * @param {string} fromFile source file path
 * @param {Set<string>|Iterable<string>} repoFiles
 * @returns {{ path: string|null, is_external: boolean, unresolved: boolean }}
 */
export function resolveImportPath(source, fromFile, repoFiles) {
  const spec = String(source || '').trim();
  if (!spec) return { path: null, is_external: false, unresolved: true };
  const files = repoFiles instanceof Set ? repoFiles : new Set(repoFiles || []);

  // Bare package / absolute URL / protocol → external
  if (!spec.startsWith('.') && !spec.startsWith('/')) {
    return { path: null, is_external: true, unresolved: false };
  }

  const fromDir = String(fromFile || '').replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  const joined = normalizeRelPath(fromDir ? `${fromDir}/${spec}` : spec);
  if (!joined || joined.includes('..')) {
    return { path: null, is_external: false, unresolved: true };
  }

  for (const suffix of RELATIVE_EXT_CANDIDATES) {
    const candidate = normalizeRelPath(`${joined}${suffix}`);
    if (candidate && files.has(candidate)) {
      return { path: candidate, is_external: false, unresolved: false };
    }
  }
  // Relative but not in tree — count unresolved (do not invent an edge)
  return { path: joined, is_external: false, unresolved: true };
}

function normalizeRelPath(path) {
  const parts = [];
  for (const seg of String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}

export async function stableEdgeId(parts) {
  const hex = await sha256Hex(parts.filter((p) => p != null).join('|'));
  return `edge_${hex.slice(0, 32)}`;
}

/**
 * Pick a module/file-level anchor node for edge endpoints.
 * Prefer import nodes as sources; prefer exported / first node as targets.
 * @param {Array<{ id: string, file_path: string, node_type: string, is_exported?: number }>} nodes
 */
export function buildFileAnchors(nodes) {
  /** @type {Map<string, string>} */
  const fileAnchor = new Map();
  /** @type {Map<string, string>} */
  const targetAnchor = new Map();
  /** @type {Map<string, Array<object>>} */
  const byFile = new Map();

  for (const node of nodes || []) {
    const fp = String(node.file_path || '');
    if (!fp || !node.id) continue;
    if (!byFile.has(fp)) byFile.set(fp, []);
    byFile.get(fp).push(node);
  }

  for (const [fp, list] of byFile) {
    const importNode = list.find((n) => n.node_type === 'import');
    fileAnchor.set(fp, (importNode || list[0]).id);
    const exported = list.find((n) => Number(n.is_exported) === 1);
    targetAnchor.set(fp, (exported || list[0]).id);
  }
  return { fileAnchor, targetAnchor, byFile };
}

/**
 * Build edge rows from structural nodes for one index job (no D1 I/O).
 * @param {object} opts
 * @param {string} opts.workspaceId
 * @param {string} opts.repo
 * @param {string} opts.indexJobId
 * @param {string} opts.indexGenerationId
 * @param {Array<object>} opts.nodes
 * @param {Iterable<string>} [opts.repoFiles] defaults to distinct node file_paths
 */
export async function buildDepEdgesFromNodes(opts) {
  const workspaceId = String(opts.workspaceId || '').trim();
  const repo = String(opts.repo || opts.repo_full_name || '').trim();
  const indexJobId = String(opts.indexJobId || '').trim();
  const indexGenerationId = normalizeCodeIndexGenerationId(
    opts.indexGenerationId ?? opts.index_generation_id,
  );
  const nodes = Array.isArray(opts.nodes) ? opts.nodes : [];
  if (!workspaceId || !repo || !indexJobId || !indexGenerationId) {
    throw new Error('buildDepEdgesFromNodes_requires_workspace_repo_job_generation');
  }

  const repoFiles = new Set(
    opts.repoFiles
      ? [...opts.repoFiles].map((p) => String(p).replace(/\\/g, '/').replace(/^\/+/, ''))
      : nodes.map((n) => String(n.file_path || '')).filter(Boolean),
  );

  const { fileAnchor, targetAnchor } = buildFileAnchors(nodes);
  const edgeSites = nodes.filter((n) => n && n.node_type === 'import' && n.node_name);

  const edges = [];
  const seen = new Set();
  let external = 0;
  let unresolved = 0;
  let written = 0;

  for (const site of edgeSites) {
    const sourceFile = String(site.file_path || '');
    const specifier = String(site.node_name || '').trim();
    if (!sourceFile || !specifier) continue;

    const sourceNodeId = site.id || fileAnchor.get(sourceFile);
    if (!sourceNodeId) {
      unresolved += 1;
      continue;
    }

    const resolved = resolveImportPath(specifier, sourceFile, repoFiles);
    const edgeType = /^export\b/.test(String(site.signature || '')) ? 're_exports' : 'imports';

    if (resolved.is_external) {
      const sig = `ext|${sourceNodeId}|${edgeType}|${specifier}|${indexGenerationId}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      const id = await stableEdgeId([
        workspaceId,
        repo,
        sourceNodeId,
        'external',
        specifier,
        edgeType,
        indexGenerationId,
        indexJobId,
      ]);
      edges.push({
        id,
        workspace_id: workspaceId,
        repo_full_name: repo,
        source_node_id: sourceNodeId,
        target_node_id: null,
        target_external: specifier.slice(0, 500),
        edge_type: edgeType,
        source_file: sourceFile,
        target_file: specifier.slice(0, 1000),
        is_external: 1,
        index_job_id: indexJobId,
        index_generation_id: indexGenerationId,
      });
      external += 1;
      written += 1;
      continue;
    }

    if (resolved.unresolved || !resolved.path || !repoFiles.has(resolved.path)) {
      unresolved += 1;
      continue;
    }

    const targetNodeId = targetAnchor.get(resolved.path);
    if (!targetNodeId) {
      unresolved += 1;
      continue;
    }

    const sig = `int|${sourceNodeId}|${targetNodeId}|${edgeType}|${indexGenerationId}`;
    if (seen.has(sig)) continue;
    seen.add(sig);

    const id = await stableEdgeId([
      workspaceId,
      repo,
      sourceNodeId,
      targetNodeId,
      edgeType,
      indexGenerationId,
      indexJobId,
    ]);
    edges.push({
      id,
      workspace_id: workspaceId,
      repo_full_name: repo,
      source_node_id: sourceNodeId,
      target_node_id: targetNodeId,
      target_external: null,
      edge_type: edgeType,
      source_file: sourceFile,
      target_file: resolved.path,
      is_external: 0,
      index_job_id: indexJobId,
      index_generation_id: indexGenerationId,
    });
    written += 1;
  }

  return {
    edges,
    counts: {
      edges_written: written,
      external,
      unresolved,
      import_sites: edgeSites.length,
    },
  };
}

/**
 * Fail loud when durable D1 rows disagree with the in-memory build (AGENTS.md §5).
 * @param {{ builtCount: number, durableCount: number, insertedCount?: number|null }} opts
 */
export function assertDepEdgeReceipt(opts) {
  const builtCount = Number(opts.builtCount) || 0;
  const durableCount = Number(opts.durableCount) || 0;
  const insertedCount =
    opts.insertedCount == null || opts.insertedCount === undefined
      ? null
      : Number(opts.insertedCount) || 0;
  if (durableCount !== builtCount) {
    throw new Error(`dep_edges_receipt_mismatch:built=${builtCount}:durable=${durableCount}`);
  }
  if (insertedCount != null && insertedCount !== builtCount) {
    throw new Error(`dep_edges_insert_mismatch:built=${builtCount}:inserted=${insertedCount}`);
  }
}

/**
 * @param {any} env
 * @param {string} jobId
 * @returns {Promise<number>}
 */
export async function countDepEdgesForJob(env, jobId) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM codebase_dep_edges WHERE index_job_id = ?`,
  )
    .bind(jobId)
    .first();
  return Number(row?.c) || 0;
}

/**
 * Relink edges for unchanged files onto the current job so activate prune
 * does not wipe them when edge_scope=delta only rewrites changed paths.
 * @param {any} env
 * @param {string} workspaceId
 * @param {string} repo
 * @param {string} jobId
 * @param {Iterable<string>} excludePaths — changed ∪ removed (do not relink)
 */
export async function relinkDepEdgesToJob(env, workspaceId, repo, jobId, excludePaths = []) {
  const exclude = new Set(
    [...(excludePaths || [])].map((p) =>
      String(p || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, ''),
    ).filter(Boolean),
  );
  // Stamp edges whose source nodes already belong to this job and whose
  // source_file is outside the delta set.
  if (exclude.size === 0) {
    await env.DB.prepare(
      `UPDATE codebase_dep_edges
          SET index_job_id = ?
        WHERE workspace_id = ? AND repo_full_name = ?
          AND COALESCE(index_job_id, '') <> ?
          AND source_node_id IN (
            SELECT id FROM codebase_ast_nodes
             WHERE workspace_id = ? AND repo_full_name = ? AND index_job_id = ?
          )`,
    )
      .bind(jobId, workspaceId, repo, jobId, workspaceId, repo, jobId)
      .run();
    return { relinked_scope: 'all_current_nodes' };
  }
  // SQLite has no great array bind — fetch candidates then filter in JS for modest repos.
  const rows = await env.DB.prepare(
    `SELECT id, source_file FROM codebase_dep_edges
      WHERE workspace_id = ? AND repo_full_name = ?
        AND COALESCE(index_job_id, '') <> ?
        AND source_node_id IN (
          SELECT id FROM codebase_ast_nodes
           WHERE workspace_id = ? AND repo_full_name = ? AND index_job_id = ?
        )`,
  )
    .bind(workspaceId, repo, jobId, workspaceId, repo, jobId)
    .all();
  const toRelink = (rows?.results || []).filter((r) => {
    const fp = String(r.source_file || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    return fp && !exclude.has(fp);
  });
  for (let offset = 0; offset < toRelink.length; offset += 40) {
    const slice = toRelink.slice(offset, offset + 40);
    await env.DB.batch(
      slice.map((r) =>
        env.DB.prepare(`UPDATE codebase_dep_edges SET index_job_id = ? WHERE id = ?`).bind(
          jobId,
          r.id,
        ),
      ),
    );
  }
  return { relinked_scope: 'exclude_changed', relinked: toRelink.length };
}

/**
 * Compute import-site files that must be rewritten for a delta edge pass:
 * changed ∪ removed ∪ files that import any changed/removed path.
 * @param {Array<{ file_path: string, node_type: string, node_name?: string, signature?: string }>} nodes
 * @param {Iterable<string>} changedPaths
 * @param {Iterable<string>} removedPaths
 * @param {Iterable<string>} [repoFiles]
 */
export function computeDeltaEdgeSourceFiles(nodes, changedPaths, removedPaths, repoFiles) {
  const changed = new Set(
    [...(changedPaths || []), ...(removedPaths || [])].map((p) =>
      String(p || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, ''),
    ).filter(Boolean),
  );
  const scope = new Set(changed);
  const files = repoFiles
    ? new Set(
        [...repoFiles].map((p) =>
          String(p || '')
            .replace(/\\/g, '/')
            .replace(/^\/+/, ''),
        ),
      )
    : new Set((nodes || []).map((n) => String(n.file_path || '')).filter(Boolean));

  for (const node of nodes || []) {
    if (!node || node.node_type !== 'import' || !node.node_name) continue;
    const sourceFile = String(node.file_path || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (!sourceFile || scope.has(sourceFile)) continue;
    const resolved = resolveImportPath(String(node.node_name), sourceFile, files);
    if (resolved.path && changed.has(resolved.path)) {
      scope.add(sourceFile);
    }
  }
  return [...scope].sort();
}

/**
 * Replace dep edges for an index job from its current D1 nodes.
 * Prunes other jobs' edges for workspace+repo BEFORE insert so
 * UNIQUE(source_node_id, target_node_id, edge_type) cannot silently drop rows
 * against stale same-revision node ids (INSERT OR IGNORE race).
 * @param {any} env
 * @param {{ id: string, workspace_id: string, repo_full_name?: string }} job
 * @param {{
 *   repoFiles?: Iterable<string>,
 *   edgeScope?: 'full'|'delta',
 *   changedPaths?: Iterable<string>,
 *   removedPaths?: Iterable<string>,
 * }} [opts]
 */
export async function writeDepEdgesForIndexJob(env, job, opts = {}) {
  const db = env?.DB;
  if (!db) throw new Error('d1_unavailable');
  const jobId = String(job.id || '').trim();
  const workspaceId = String(job.workspace_id || '').trim();
  const repo = String(job.repo_full_name || '').trim();
  if (!jobId || !workspaceId || !repo) throw new Error('writeDepEdgesForIndexJob_missing_ids');
  const indexGenerationId = resolveJobIndexGenerationId(job);

  const edgeScope = opts.edgeScope === 'delta' ? 'delta' : 'full';
  const changedPaths = [...(opts.changedPaths || [])].map(String).filter(Boolean);
  const removedPaths = [...(opts.removedPaths || [])].map(String).filter(Boolean);

  // Cheap resume gate BEFORE loading ~20k nodes (OOM / CPU kill on activate).
  if (edgeScope === 'full') {
    await pruneDepEdgesForActivate(env, workspaceId, repo, jobId, {
      index_generation_id: indexGenerationId,
    });
    const durableBefore = await countDepEdgesForJob(env, jobId);
    const importishRow = await db
      .prepare(
        `SELECT COUNT(*) AS c FROM codebase_ast_nodes
          WHERE index_job_id = ?
            AND node_type IN ('import', 're_export')`,
      )
      .bind(jobId)
      .first()
      .catch(() => null);
    const importish = Math.max(0, Number(importishRow?.c) || 0);
    // Slack of 200 was written for ~20k-node repos; on small repos (importish < 200)
    // it collapses to ">= 1 edge" and silently reuses a tiny partial. Require ratio
    // or a bounded absolute slack that cannot exceed ~4% of importish (min 1).
    const absSlack = Math.max(1, Math.min(200, Math.floor(importish * 0.04)));
    const closeEnough =
      durableBefore > 0 &&
      (importish === 0 ||
        durableBefore >= Math.max(1, importish - absSlack) ||
        durableBefore / importish >= 0.96);
    if (closeEnough) {
      return {
        edges_written: durableBefore,
        edges_durable: durableBefore,
        edges_inserted: 0,
        external: 0,
        unresolved: 0,
        import_sites: durableBefore,
        edge_scope: 'full',
        reused_partial: true,
        importish_nodes: importish,
      };
    }
  }

  const nodeRows = await db
    .prepare(
      `SELECT id, file_path, node_type, node_name, is_exported, signature
         FROM codebase_ast_nodes
        WHERE workspace_id = ? AND repo_full_name = ? AND index_job_id = ?`,
    )
    .bind(workspaceId, repo, jobId)
    .all();
  const nodes = nodeRows?.results || [];

  if (edgeScope === 'delta' && (changedPaths.length || removedPaths.length)) {
    const scopeFiles = computeDeltaEdgeSourceFiles(
      nodes,
      changedPaths,
      removedPaths,
      opts.repoFiles,
    );
    const exclude = new Set(scopeFiles);
    await relinkDepEdgesToJob(env, workspaceId, repo, jobId, exclude);

    // Drop edges touching delta source/target paths for this job, then rewrite.
    for (const fp of scopeFiles) {
      await db
        .prepare(
          `DELETE FROM codebase_dep_edges
            WHERE workspace_id = ? AND repo_full_name = ?
              AND index_job_id = ?
              AND (source_file = ? OR target_file = ?)`,
        )
        .bind(workspaceId, repo, jobId, fp, fp)
        .run();
    }

    const scopedNodes = nodes.filter((n) => {
      const fp = String(n.file_path || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      // Need anchors for all files for resolve; build from all nodes but only
      // emit edges whose source_file is in scope (filter after build).
      return Boolean(fp);
    });
    const built = await buildDepEdgesFromNodes({
      workspaceId,
      repo,
      indexJobId: jobId,
      indexGenerationId,
      nodes: scopedNodes,
      repoFiles: opts.repoFiles,
    });
    const deltaEdges = built.edges.filter((e) =>
      exclude.has(
        String(e.source_file || '')
          .replace(/\\/g, '/')
          .replace(/^\/+/, ''),
      ),
    );
    const insertResult = await insertDepEdges(env, deltaEdges);
    // Other-job orphans still pruned at activate; do not wipe relinked edges here.
    await pruneDepEdgesForActivate(env, workspaceId, repo, jobId, {
      index_generation_id: indexGenerationId,
    });
    const durable = await countDepEdgesForJob(env, jobId);
    return {
      edges_written: durable,
      edges_durable: durable,
      edges_inserted: insertResult.inserted,
      external: deltaEdges.filter((e) => e.is_external).length,
      unresolved: built.counts.unresolved,
      import_sites: deltaEdges.length,
      edge_scope: 'delta',
      delta_source_files: scopeFiles.length,
    };
  }

  // Full path (fresh or incomplete resume). Other-job prune already ran above when full.
  const durableBefore = await countDepEdgesForJob(env, jobId);
  if (durableBefore === 0) {
    // Fresh write: wipe this run then plain INSERT (fail loud on conflicts).
    await db
      .prepare(`DELETE FROM codebase_dep_edges WHERE index_job_id = ?`)
      .bind(jobId)
      .run();
  }

  const built = await buildDepEdgesFromNodes({
    workspaceId,
    repo,
    indexJobId: jobId,
    indexGenerationId,
    nodes,
    repoFiles: opts.repoFiles,
  });

  // Partial resume uses OR IGNORE so existing rows from a killed attempt stay.
  const insertResult =
    durableBefore > 0
      ? await insertDepEdgesOrIgnore(env, built.edges)
      : await insertDepEdges(env, built.edges);
  const durable = await countDepEdgesForJob(env, jobId);
  // Durable COUNT is authoritative; meta.changes is only gated when D1 reports it.
  // Skip strict insert==built gate on OR IGNORE resume (many rows already present).
  if (durableBefore === 0) {
    assertDepEdgeReceipt({
      builtCount: built.edges.length,
      durableCount: durable,
      insertedCount: insertResult.changes_observed ? insertResult.inserted : null,
    });
  }

  return {
    ...built.counts,
    edges_written: durable,
    edges_durable: durable,
    edges_inserted: insertResult.inserted,
    edge_scope: 'full',
    resumed_partial: durableBefore > 0,
  };
}

/**
 * @param {any} env
 * @param {Array<object>} edges
 * @returns {Promise<{ inserted: number, changes_observed: boolean }>}
 */
export async function insertDepEdges(env, edges) {
  return insertDepEdgesWithSql(
    env,
    edges,
    `INSERT INTO codebase_dep_edges (
       id, workspace_id, repo_full_name, source_node_id, target_node_id, target_external,
       edge_type, source_file, target_file, is_external, index_job_id, index_generation_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
  );
}

/** Resume after isolate kill — keep existing rows, fill gaps. */
export async function insertDepEdgesOrIgnore(env, edges) {
  return insertDepEdgesWithSql(
    env,
    edges,
    `INSERT OR IGNORE INTO codebase_dep_edges (
       id, workspace_id, repo_full_name, source_node_id, target_node_id, target_external,
       edge_type, source_file, target_file, is_external, index_job_id, index_generation_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
  );
}

/** D1 rejects `undefined` binds; nullable cols must be explicit null. */
function d1BindOrNull(value) {
  return value === undefined ? null : value;
}

/**
 * Drop edges whose AST node FKs are missing — never abort a 5h index on one orphan id.
 * @param {any} db
 * @param {Array<object>} edges
 * @returns {Promise<{ edges: Array<object>, skipped: number }>}
 */
async function filterEdgesWithLiveAstNodes(db, edges) {
  if (!edges?.length) return { edges: [], skipped: 0 };
  const ids = new Set();
  for (const e of edges) {
    if (e?.source_node_id) ids.add(String(e.source_node_id));
    if (e?.target_node_id) ids.add(String(e.target_node_id));
  }
  const live = new Set();
  const list = [...ids];
  for (let i = 0; i < list.length; i += 80) {
    const chunk = list.slice(i, i + 80);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await db
      .prepare(`SELECT id FROM codebase_ast_nodes WHERE id IN (${placeholders})`)
      .bind(...chunk)
      .all()
      .catch(() => null);
    for (const r of rows?.results || []) {
      if (r?.id) live.add(String(r.id));
    }
  }
  const kept = [];
  let skipped = 0;
  for (const e of edges) {
    const src = e?.source_node_id != null ? String(e.source_node_id) : '';
    if (!src || !live.has(src)) {
      skipped += 1;
      continue;
    }
    const external = Number(e.is_external) === 1;
    if (!external) {
      const tgt = e?.target_node_id != null ? String(e.target_node_id) : '';
      if (!tgt || !live.has(tgt)) {
        skipped += 1;
        continue;
      }
    }
    kept.push(e);
  }
  return { edges: kept, skipped };
}

function bindDepEdgeStatement(db, sql, e) {
  const repoFull =
    e.repo_full_name != null && String(e.repo_full_name).trim()
      ? String(e.repo_full_name).trim()
      : e.repo != null && String(e.repo).trim()
        ? String(e.repo).trim()
        : '';
  const generationId = normalizeCodeIndexGenerationId(e.index_generation_id);
  if (
    !e?.id ||
    !e?.workspace_id ||
    !repoFull ||
    !e?.source_node_id ||
    !e?.edge_type ||
    !e?.index_job_id ||
    !generationId
  ) {
    throw new Error(
      `dep_edge_bind_incomplete:id=${e?.id || ''}:repo=${repoFull || 'missing'}:type=${e?.edge_type || ''}:gen=${generationId || 'missing'}`,
    );
  }
  return db.prepare(sql).bind(
    e.id,
    e.workspace_id,
    repoFull,
    e.source_node_id,
    d1BindOrNull(e.target_node_id),
    d1BindOrNull(e.target_external),
    e.edge_type,
    d1BindOrNull(e.source_file),
    d1BindOrNull(e.target_file),
    e.is_external ? 1 : 0,
    e.index_job_id,
    generationId,
  );
}

async function insertDepEdgesWithSql(env, edges, sql) {
  if (!edges?.length) return { inserted: 0, changes_observed: true, skipped_orphan: 0 };
  const db = env.DB;
  const filtered = await filterEdgesWithLiveAstNodes(db, edges);
  const work = filtered.edges;
  let inserted = 0;
  let changesObserved = true;
  let skippedOrphan = filtered.skipped;

  for (let offset = 0; offset < work.length; offset += 40) {
    const slice = work.slice(offset, offset + 40);
    const batch = slice.map((e) => bindDepEdgeStatement(db, sql, e));
    try {
      const results = await db.batch(batch);
      if (!results?.length) {
        changesObserved = false;
        continue;
      }
      for (const r of results) {
        if (r?.meta?.changes == null) {
          changesObserved = false;
        } else {
          inserted += Number(r.meta.changes) || 0;
        }
      }
    } catch (batchErr) {
      // One bad row must not kill the shard — insert survivors one-by-one.
      const msg = String(batchErr?.message || batchErr || '');
      console.warn('[codebase-dep-edges] batch_insert_fallback', msg.slice(0, 180));
      for (const e of slice) {
        try {
          const r = await bindDepEdgeStatement(db, sql, e).run();
          inserted += Number(r?.meta?.changes) || 0;
        } catch (rowErr) {
          skippedOrphan += 1;
          console.warn(
            '[codebase-dep-edges] skip_edge',
            String(e?.id || '').slice(0, 40),
            String(rowErr?.message || rowErr).slice(0, 120),
          );
        }
      }
    }
  }
  return { inserted, changes_observed: changesObserved, skipped_orphan: skippedOrphan };
}

/**
 * Activate / full-edge rewrite prune: drop sibling edges for THIS generation only.
 * Never wipe other generations (A must survive while B builds/activates).
 * @param {any} env
 * @param {string} workspaceId
 * @param {string} repo
 * @param {string} jobId
 * @param {{ indexGenerationId?: string, index_generation_id?: string }} [opts]
 */
export async function pruneDepEdgesForActivate(env, workspaceId, repo, jobId, opts = {}) {
  const generationId = normalizeCodeIndexGenerationId(
    opts.indexGenerationId ?? opts.index_generation_id,
  );
  if (!generationId) {
    throw new Error('prune_dep_edges_for_activate_generation_required');
  }
  await env.DB.prepare(
    `DELETE FROM codebase_dep_edges
      WHERE workspace_id = ?
        AND repo_full_name = ?
        AND index_generation_id = ?
        AND COALESCE(index_job_id, '') <> ?`,
  )
    .bind(workspaceId, repo, generationId, jobId)
    .run();
}

/**
 * Best-effort delete edges touching a file (source or target path) before node wipe.
 * CASCADE may already cover source_node deletes; this is belt-and-suspenders.
 */
export async function deleteDepEdgesForFile(env, workspaceId, repo, filePath, opts = {}) {
  const generationId = normalizeCodeIndexGenerationId(
    opts.indexGenerationId ?? opts.index_generation_id,
  );
  if (!generationId) {
    throw new Error('delete_dep_edges_for_file_generation_required');
  }
  await env.DB.prepare(
    `DELETE FROM codebase_dep_edges
      WHERE workspace_id = ? AND repo_full_name = ?
        AND index_generation_id = ?
        AND (source_file = ? OR target_file = ?)`,
  )
    .bind(workspaceId, repo, generationId, filePath, filePath)
    .run()
    .catch(() => null);
}
