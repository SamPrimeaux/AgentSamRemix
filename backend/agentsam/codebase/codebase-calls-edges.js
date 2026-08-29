/**
 * Call-graph edges (edge_type='calls') for Worker full-index jobs.
 * Runs AFTER import/re_export edges so import-follow resolution works.
 * Never invents edges on name collision or dynamic callees.
 */

import {
  resolveImportPath,
  stableEdgeId,
  insertDepEdges,
  insertDepEdgesOrIgnore,
} from './codebase-dep-edges.js';
import { resolveJobIndexGenerationId } from './code-index-generation.js';

const CALL_GRAPH_SIDECAR = (jobId) =>
  `agentsam/code-index/${String(jobId || '').trim()}/call_graph.json`;
const CALL_GRAPH_SHARDS_META = (jobId) =>
  `agentsam/code-index/${String(jobId || '').trim()}/call_graph_shards.json`;
const CALL_GRAPH_SHARD = (jobId, index) =>
  `agentsam/code-index/${String(jobId || '').trim()}/call_graph_shard_${String(index).padStart(4, '0')}.json`;
/** Files per R2 shard — never hold the full ~30MB sidecar + nodes in one isolate. */
const CALLS_BACKFILL_FILES_PER_SHARD = 40;

const FUNCTION_LIKE = new Set([
  'function',
  'method',
  'arrow_function',
  'component',
  'hook',
]);

function normalizePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

function chooseSameFileTarget(candidates, callLine) {
  if (!candidates.length) return null;
  const functionLike = candidates.filter((n) => FUNCTION_LIKE.has(String(n.node_type)));
  const ranked = functionLike.length ? functionLike : candidates;
  const line = Number(callLine) || 0;
  if (line > 0) {
    const preceding = ranked
      .filter((n) => (Number(n.line_start) || 0) <= line)
      .sort((a, b) => (Number(b.line_start) || 0) - (Number(a.line_start) || 0));
    if (preceding.length) {
      const bestLine = Number(preceding[0].line_start) || 0;
      const best = preceding.filter((n) => (Number(n.line_start) || 0) === bestLine);
      if (best.length === 1) return best[0];
      return { ambiguous: true };
    }
  }
  return ranked.length === 1 ? ranked[0] : { ambiguous: true };
}

/**
 * Resolve a static call site to a target codebase_ast_nodes id.
 * @param {object} opts
 * @param {object} opts.callSite
 * @param {Array<object>} opts.nodes
 * @param {Array<object>} [opts.importEdges] imports/re_exports for this job
 * @param {Array<object>} [opts.importBindings] local→specifier from parse
 * @param {Set<string>|Iterable<string>} [opts.repoFiles]
 * @returns {{ target_node_id: string|null, status: 'resolved'|'unresolved'|'ambiguous'|'dynamic_skipped' }}
 */
export function resolveCallee(opts) {
  const callSite = opts.callSite || {};
  if (callSite.dynamic || !callSite.callee_name) {
    return { target_node_id: null, status: 'dynamic_skipped' };
  }

  const calleeName = String(callSite.callee_name);
  const sourceFile = normalizePath(callSite.file_path);
  const nodes = Array.isArray(opts.nodes) ? opts.nodes : [];
  const repoFiles = opts.repoFiles
    ? opts.repoFiles instanceof Set
      ? opts.repoFiles
      : new Set(
          [...opts.repoFiles].map((p) =>
            String(p || '')
              .replace(/\\/g, '/')
              .replace(/^\/+/, ''),
          ),
        )
    : new Set(nodes.map((n) => String(n.file_path || '')).filter(Boolean));

  // 1) Same-file binding
  const sameFile = nodes.filter((n) => {
    const fp = normalizePath(n.file_path);
    return (
      fp === sourceFile &&
      n.node_name === calleeName &&
      (FUNCTION_LIKE.has(String(n.node_type)) ||
        n.node_type === 'class' ||
        n.node_type === 'const')
    );
  });
  const sameFileTarget = chooseSameFileTarget(sameFile, callSite.line);
  if (sameFileTarget?.id) {
    return { target_node_id: sameFileTarget.id, status: 'resolved' };
  }
  if (sameFileTarget?.ambiguous) {
    return { target_node_id: null, status: 'ambiguous' };
  }

  // Parser upgrades can leave a helper with a non-standard node_type. If its
  // name and source span are still exact, resolve it before widening to exports.
  const sameFileNamed = nodes.filter(
    (n) => normalizePath(n.file_path) === sourceFile && n.node_name === calleeName,
  );
  const fallbackTarget = chooseSameFileTarget(sameFileNamed, callSite.line);
  if (fallbackTarget?.id) {
    return { target_node_id: fallbackTarget.id, status: 'resolved' };
  }
  if (fallbackTarget?.ambiguous) {
    return { target_node_id: null, status: 'ambiguous' };
  }

  // 2) Imported binding → follow import edge / resolve path → exported symbol
  const bindings = (opts.importBindings || []).filter(
    (b) =>
      b &&
      b.local === calleeName &&
      (!b.file_path ||
        String(b.file_path)
          .replace(/\\/g, '/')
          .replace(/^\/+/, '') === sourceFile),
  );

  // Namespace member: member_path "ns.foo" with binding ns → *
  let importedName = calleeName;
  let specifier = null;
  if (callSite.member_path && String(callSite.member_path).includes('.')) {
    const [ns, prop] = String(callSite.member_path).split('.');
    const nsBind = (opts.importBindings || []).find(
      (b) =>
        b &&
        b.local === ns &&
        b.imported === '*' &&
        (!b.file_path ||
          normalizePath(b.file_path) === sourceFile),
    );
    if (nsBind) {
      specifier = nsBind.specifier;
      importedName = prop;
    }
  }

  if (!specifier && bindings.length === 1) {
    specifier = bindings[0].specifier;
    importedName =
      bindings[0].imported && bindings[0].imported !== '*'
        ? bindings[0].imported === 'default'
          ? calleeName
          : bindings[0].imported
        : calleeName;
  } else if (!specifier && bindings.length > 1) {
    return { target_node_id: null, status: 'ambiguous' };
  }

  if (specifier) {
    const resolved = resolveImportPath(specifier, sourceFile, repoFiles);
    if (!resolved.unresolved && !resolved.is_external && resolved.path) {
      const targets = nodes.filter((n) => {
        const fp = String(n.file_path || '')
          .replace(/\\/g, '/')
          .replace(/^\/+/, '');
        return (
          fp === resolved.path &&
          Number(n.is_exported) === 1 &&
          (n.node_name === importedName ||
            (importedName === calleeName && n.node_name === calleeName))
        );
      });
      if (targets.length === 1) {
        return { target_node_id: targets[0].id, status: 'resolved' };
      }
      if (targets.length > 1) {
        return { target_node_id: null, status: 'ambiguous' };
      }
    }

    // Follow job import edges when path resolve failed but edge exists
    const importEdges = (opts.importEdges || []).filter(
      (e) =>
        e &&
        (e.edge_type === 'imports' || e.edge_type === 're_exports') &&
        String(e.source_file || '')
          .replace(/\\/g, '/')
          .replace(/^\/+/, '') === sourceFile &&
        !e.is_external &&
        e.target_file,
    );
    for (const edge of importEdges) {
      const targetFile = String(edge.target_file)
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      // Prefer edges whose source import node matches specifier via node_name
      const sourceNode = nodes.find((n) => n.id === edge.source_node_id);
      if (sourceNode && sourceNode.node_name && sourceNode.node_name !== specifier) continue;
      const targets = nodes.filter((n) => {
        const fp = String(n.file_path || '')
          .replace(/\\/g, '/')
          .replace(/^\/+/, '');
        return fp === targetFile && Number(n.is_exported) === 1 && n.node_name === importedName;
      });
      if (targets.length === 1) {
        return { target_node_id: targets[0].id, status: 'resolved' };
      }
      if (targets.length > 1) {
        return { target_node_id: null, status: 'ambiguous' };
      }
    }
  }

  // 3) Same-repo unique exported symbol with that name
  const exported = nodes.filter(
    (n) => Number(n.is_exported) === 1 && n.node_name === calleeName && FUNCTION_LIKE.has(String(n.node_type)),
  );
  if (exported.length === 1) {
    return { target_node_id: exported[0].id, status: 'resolved' };
  }
  if (exported.length > 1) {
    return { target_node_id: null, status: 'ambiguous' };
  }

  return { target_node_id: null, status: 'unresolved' };
}

/**
 * Build calls edges from call sites + nodes (no D1 I/O).
 */
export async function buildCallsEdgesFromSites(opts) {
  const workspaceId = String(opts.workspaceId || '').trim();
  const repo = String(opts.repo || opts.repo_full_name || '').trim();
  const indexJobId = String(opts.indexJobId || '').trim();
  const indexGenerationId =
    opts.indexGenerationId != null && String(opts.indexGenerationId).trim()
      ? String(opts.indexGenerationId).trim()
      : opts.index_generation_id != null && String(opts.index_generation_id).trim()
        ? String(opts.index_generation_id).trim()
        : '';
  if (!workspaceId || !repo || !indexJobId || !indexGenerationId) {
    throw new Error('buildCallsEdgesFromSites_requires_workspace_repo_job_generation');
  }

  const nodes = Array.isArray(opts.nodes) ? opts.nodes : [];
  const callSites = Array.isArray(opts.callSites) ? opts.callSites : [];
  const importBindings = Array.isArray(opts.importBindings) ? opts.importBindings : [];
  const importEdges = Array.isArray(opts.importEdges) ? opts.importEdges : [];
  const repoFiles = opts.repoFiles;

  const edges = [];
  const seen = new Set();
  let calls_written = 0;
  let calls_unresolved = 0;
  let calls_ambiguous = 0;
  let calls_dynamic_skipped = 0;

  const nodeById = new Map(nodes.map((n) => [String(n.id), n]));

  for (const site of callSites) {
    if (!site?.enclosing_node_id) {
      // Top-level skipped at parse; belt-and-suspenders
      continue;
    }
    // Sidecar can reference enclosing ids that never landed in D1 for this job.
    if (!nodeById.has(String(site.enclosing_node_id))) {
      calls_unresolved += 1;
      continue;
    }
    const resolved = resolveCallee({
      callSite: site,
      nodes,
      importBindings: importBindings.filter(
        (b) =>
          !b.file_path ||
          String(b.file_path)
            .replace(/\\/g, '/')
            .replace(/^\/+/, '') ===
            String(site.file_path || '')
              .replace(/\\/g, '/')
              .replace(/^\/+/, ''),
      ),
      importEdges,
      repoFiles,
    });

    if (resolved.status === 'dynamic_skipped') {
      calls_dynamic_skipped += 1;
      continue;
    }
    if (resolved.status === 'ambiguous') {
      calls_ambiguous += 1;
      continue;
    }
    if (resolved.status === 'unresolved' || !resolved.target_node_id) {
      calls_unresolved += 1;
      continue;
    }

    // Never self-edge noise for recursive same symbol if desired — allow self calls
    const sig = `${site.enclosing_node_id}|${resolved.target_node_id}|calls|${indexGenerationId}`;
    if (seen.has(sig)) continue;
    seen.add(sig);

    const sourceFile = String(site.file_path || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    if (!nodeById.has(String(resolved.target_node_id))) {
      calls_unresolved += 1;
      continue;
    }
    const targetNode = nodeById.get(String(resolved.target_node_id));
    const targetFile = targetNode
      ? String(targetNode.file_path || '')
          .replace(/\\/g, '/')
          .replace(/^\/+/, '')
      : sourceFile;

    const id = await stableEdgeId([
      workspaceId,
      repo,
      site.enclosing_node_id,
      resolved.target_node_id,
      'calls',
      indexGenerationId,
      indexJobId,
    ]);

    // Field names must match insertDepEdgesWithSql binds (repo_full_name, not repo).
    edges.push({
      id,
      workspace_id: workspaceId,
      repo_full_name: repo,
      source_node_id: site.enclosing_node_id,
      target_node_id: resolved.target_node_id,
      target_external: null,
      edge_type: 'calls',
      source_file: sourceFile || null,
      target_file: targetFile || null,
      is_external: 0,
      index_job_id: indexJobId,
      index_generation_id: indexGenerationId,
    });
    calls_written += 1;
  }

  return {
    edges,
    counts: {
      calls_written,
      calls_unresolved,
      calls_ambiguous,
      calls_dynamic_skipped,
      call_sites: callSites.length,
    },
  };
}

/**
 * Collect compact call_sites + import_bindings from file_manifest files[].
 */
export function collectCallGraphFromManifest(manifest) {
  const callSites = [];
  const importBindings = [];
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  for (const f of files) {
    const path = f?.path != null ? String(f.path) : '';
    if (!path) continue;
    for (const cs of f.call_sites || []) {
      callSites.push({
        ...cs,
        file_path: cs.file_path || path,
      });
    }
    for (const ib of f.import_bindings || []) {
      importBindings.push({
        ...ib,
        file_path: ib.file_path || path,
      });
    }
  }
  return { callSites, importBindings };
}

/**
 * INSERT calls edges for an index job (does not wipe imports).
 * @param {any} env
 * @param {{ id: string, workspace_id: string, repo_full_name?: string }} job
 * @param {{
 *   callSites?: Array<object>,
 *   importBindings?: Array<object>,
 *   repoFiles?: Iterable<string>,
 *   manifest?: object,
 * }} [opts]
 */
export async function writeCallsEdgesForIndexJob(env, job, opts = {}) {
  const db = env?.DB;
  if (!db) throw new Error('d1_unavailable');
  const jobId = String(job.id || '').trim();
  const workspaceId = String(job.workspace_id || '').trim();
  const repo = String(job.repo_full_name || '').trim();
  if (!jobId || !workspaceId || !repo) throw new Error('writeCallsEdgesForIndexJob_missing_ids');

  const fromManifest = opts.manifest ? collectCallGraphFromManifest(opts.manifest) : null;
  const callSites = opts.callSites || fromManifest?.callSites || [];
  const importBindings = opts.importBindings || fromManifest?.importBindings || [];

  const nodeRows = await db
    .prepare(
      `SELECT id, file_path, node_type, node_name, is_exported, signature, line_start, line_end
         FROM codebase_ast_nodes
        WHERE workspace_id = ? AND repo_full_name = ? AND index_job_id = ?`,
    )
    .bind(workspaceId, repo, jobId)
    .all();
  const nodes = nodeRows?.results || [];

  const edgeRows = await db
    .prepare(
      `SELECT id, source_node_id, target_node_id, edge_type, source_file, target_file, is_external
         FROM codebase_dep_edges
        WHERE index_job_id = ? AND edge_type IN ('imports', 're_exports')`,
    )
    .bind(jobId)
    .all();
  const importEdges = edgeRows?.results || [];

  // Drop prior calls for this job only (idempotent re-verify); keep imports.
  await db
    .prepare(`DELETE FROM codebase_dep_edges WHERE index_job_id = ? AND edge_type = 'calls'`)
    .bind(jobId)
    .run();

  const built = await buildCallsEdgesFromSites({
    workspaceId,
    repo,
    indexJobId: jobId,
    indexGenerationId: resolveJobIndexGenerationId(job),
    nodes,
    callSites,
    importBindings,
    importEdges,
    repoFiles: opts.repoFiles,
  });

  const insertResult = await insertDepEdges(env, built.edges);
  return {
    ...built.counts,
    calls_inserted: insertResult.inserted,
  };
}

async function r2Bucket(env) {
  return env?.ARTIFACTS || env?.ASSETS || null;
}

async function loadJsonR2(env, key) {
  const bucket = await r2Bucket(env);
  if (!bucket?.get) return null;
  const obj = await bucket.get(key).catch(() => null);
  if (!obj) return null;
  try {
    return JSON.parse(await obj.text());
  } catch {
    return null;
  }
}

/**
 * Split monolith call_graph.json (~30MB) into small shards once.
 * Subsequent Level-2 chunks load one shard only.
 */
export async function ensureCallGraphShards(env, jobId) {
  const id = String(jobId || '').trim();
  if (!id) return { ok: false, error: 'run_id_required' };
  const bucket = await r2Bucket(env);
  if (!bucket?.get || !bucket?.put) return { ok: false, error: 'r2_unavailable' };

  const existing = await loadJsonR2(env, CALL_GRAPH_SHARDS_META(id));
  if (
    existing &&
    Number(existing.shard_count) > 0 &&
    Array.isArray(existing.paths) &&
    existing.paths.length
  ) {
    return {
      ok: true,
      shard_count: Number(existing.shard_count),
      file_count: Number(existing.file_count) || existing.paths.length,
      paths: existing.paths.map(String),
      reused: true,
    };
  }

  const monolith = await loadJsonR2(env, CALL_GRAPH_SIDECAR(id));
  const files = monolith?.files && typeof monolith.files === 'object' ? monolith.files : null;
  if (!files || !Object.keys(files).length) {
    return { ok: false, error: 'call_graph_sidecar_missing' };
  }

  const paths = Object.keys(files).sort();
  const shardCount = Math.ceil(paths.length / CALLS_BACKFILL_FILES_PER_SHARD);
  for (let i = 0; i < shardCount; i += 1) {
    const slice = paths.slice(
      i * CALLS_BACKFILL_FILES_PER_SHARD,
      (i + 1) * CALLS_BACKFILL_FILES_PER_SHARD,
    );
    /** @type {Record<string, object>} */
    const part = {};
    for (const p of slice) part[p] = files[p];
    await bucket.put(CALL_GRAPH_SHARD(id, i), JSON.stringify({ files: part }), {
      httpMetadata: { contentType: 'application/json' },
    });
  }
  const meta = {
    job_id: id,
    shard_count: shardCount,
    file_count: paths.length,
    files_per_shard: CALLS_BACKFILL_FILES_PER_SHARD,
    paths,
    updated_at: Math.floor(Date.now() / 1000),
  };
  await bucket.put(CALL_GRAPH_SHARDS_META(id), JSON.stringify(meta), {
    httpMetadata: { contentType: 'application/json' },
  });
  return {
    ok: true,
    shard_count: shardCount,
    file_count: paths.length,
    paths,
    reused: false,
  };
}

export async function countCallsEdgesForJob(env, jobId) {
  const id = String(jobId || '').trim();
  if (!env?.DB || !id) return 0;
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM codebase_dep_edges
      WHERE index_job_id = ? AND edge_type = 'calls'`,
  )
    .bind(id)
    .first()
    .catch(() => null);
  return Math.max(0, Number(row?.c) || 0);
}

function normalizeRelPath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

/** Chunked IN (…) loads — never SELECT the full 22k-node job into isolate memory. */
async function loadAstNodesForFiles(db, workspaceId, repo, jobId, filePaths) {
  const paths = [...new Set((filePaths || []).map(normalizeRelPath).filter(Boolean))];
  if (!paths.length) return [];
  const out = [];
  const chunkSize = 40;
  for (let i = 0; i < paths.length; i += chunkSize) {
    const chunk = paths.slice(i, i + chunkSize);
    const ph = chunk.map(() => '?').join(',');
    const rows = await db
      .prepare(
        `SELECT id, file_path, node_type, node_name, is_exported
           FROM codebase_ast_nodes
          WHERE workspace_id = ? AND repo_full_name = ? AND index_job_id = ?
            AND file_path IN (${ph})`,
      )
      .bind(workspaceId, repo, jobId, ...chunk)
      .all()
      .catch(() => null);
    for (const r of rows?.results || []) out.push(r);
  }
  return out;
}

async function loadImportEdgesForSources(db, jobId, sourceFiles) {
  const paths = [...new Set((sourceFiles || []).map(normalizeRelPath).filter(Boolean))];
  if (!paths.length) return [];
  const out = [];
  const chunkSize = 40;
  for (let i = 0; i < paths.length; i += chunkSize) {
    const chunk = paths.slice(i, i + chunkSize);
    const ph = chunk.map(() => '?').join(',');
    const rows = await db
      .prepare(
        `SELECT id, source_node_id, target_node_id, edge_type, source_file, target_file, is_external
           FROM codebase_dep_edges
          WHERE index_job_id = ? AND edge_type IN ('imports', 're_exports')
            AND source_file IN (${ph})`,
      )
      .bind(jobId, ...chunk)
      .all()
      .catch(() => null);
    for (const r of rows?.results || []) out.push(r);
  }
  return out;
}

/**
 * Repo-wide unique exported function-like symbols for step-3 resolve.
 * Only returns names with exactly one match — avoids pulling thousands of `map`/`get` rows.
 */
async function loadExportedNodesByNames(db, workspaceId, repo, jobId, names) {
  const uniq = [...new Set((names || []).map((n) => String(n || '').trim()).filter(Boolean))];
  if (!uniq.length) return [];
  const out = [];
  const types = [...FUNCTION_LIKE];
  const typePh = types.map(() => '?').join(',');
  const chunkSize = 30;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    const namePh = chunk.map(() => '?').join(',');
    const rows = await db
      .prepare(
        `SELECT id, file_path, node_type, node_name, is_exported
           FROM codebase_ast_nodes
          WHERE workspace_id = ? AND repo_full_name = ? AND index_job_id = ?
            AND is_exported = 1
            AND node_type IN (${typePh})
            AND node_name IN (${namePh})
            AND node_name IN (
              SELECT node_name FROM codebase_ast_nodes
               WHERE workspace_id = ? AND repo_full_name = ? AND index_job_id = ?
                 AND is_exported = 1
                 AND node_type IN (${typePh})
                 AND node_name IN (${namePh})
               GROUP BY node_name
              HAVING COUNT(*) = 1
            )`,
      )
      .bind(
        workspaceId,
        repo,
        jobId,
        ...types,
        ...chunk,
        workspaceId,
        repo,
        jobId,
        ...types,
        ...chunk,
      )
      .all()
      .catch(() => null);
    for (const r of rows?.results || []) out.push(r);
  }
  return out;
}

/**
 * One shard of Level-2 calls backfill (no re-crawl / re-embed).
 */
export async function backfillCallsEdgesChunk(env, job, opts = {}) {
  const db = env?.DB;
  if (!db) throw new Error('d1_unavailable');
  const jobId = String(job.id || '').trim();
  const workspaceId = String(job.workspace_id || '').trim();
  const repo = String(job.repo_full_name || '').trim();
  if (!jobId || !workspaceId || !repo) throw new Error('writeCallsEdgesForIndexJob_missing_ids');

  const shards =
    opts.shards && Number(opts.shards.shard_count) > 0
      ? opts.shards
      : await ensureCallGraphShards(env, jobId);
  if (!shards?.ok) {
    return {
      complete: true,
      next_shard_index: 0,
      next_file_offset: 0,
      total_files: 0,
      total_shards: 0,
      calls_written: await countCallsEdgesForJob(env, jobId),
      batch_calls: 0,
      error: shards?.error || 'call_graph_sidecar_missing',
    };
  }

  const shardIndex = Math.max(0, Number(opts.shardIndex) || 0);
  const totalShards = Number(shards.shard_count) || 0;
  const allPaths = Array.isArray(shards.paths) ? shards.paths.map(String) : [];

  if (shardIndex === 0) {
    await db
      .prepare(`DELETE FROM codebase_dep_edges WHERE index_job_id = ? AND edge_type = 'calls'`)
      .bind(jobId)
      .run();
  }

  if (shardIndex >= totalShards) {
    const total = await countCallsEdgesForJob(env, jobId);
    return {
      complete: true,
      next_shard_index: totalShards,
      next_file_offset: allPaths.length,
      total_files: allPaths.length,
      total_shards: totalShards,
      calls_written: total,
      batch_calls: 0,
    };
  }

  const shard = await loadJsonR2(env, CALL_GRAPH_SHARD(jobId, shardIndex));
  const sidecarFiles = shard?.files && typeof shard.files === 'object' ? shard.files : {};

  const callSites = [];
  const importBindings = [];
  const batchPaths = [];
  for (const rawPath of Object.keys(sidecarFiles)) {
    const path = normalizeRelPath(rawPath);
    batchPaths.push(path);
    const side = sidecarFiles[rawPath] || {};
    for (const cs of side.call_sites || []) {
      callSites.push({ ...cs, file_path: normalizeRelPath(cs.file_path || path) });
    }
    for (const ib of side.import_bindings || []) {
      importBindings.push({ ...ib, file_path: normalizeRelPath(ib.file_path || path) });
    }
  }

  // Lean loads only — full-job node SELECT (~23k rows) OOMs the isolate before shard 0 finishes.
  const importEdges = await loadImportEdgesForSources(db, jobId, batchPaths);
  const targetFiles = importEdges
    .map((e) => normalizeRelPath(e.target_file))
    .filter(Boolean);
  const bindingTargets = [];
  for (const ib of importBindings) {
    if (!ib?.specifier || String(ib.specifier).startsWith('.')) {
      const resolved = resolveImportPath(String(ib.specifier || ''), String(ib.file_path || ''), allPaths);
      if (!resolved.unresolved && !resolved.is_external && resolved.path) {
        bindingTargets.push(resolved.path);
      }
    }
  }
  const fileSet = [...new Set([...batchPaths, ...targetFiles, ...bindingTargets])];
  let nodes = await loadAstNodesForFiles(db, workspaceId, repo, jobId, fileSet);
  const calleeNames = [
    ...new Set(
      callSites
        .map((s) => String(s?.callee_name || '').trim())
        .filter(Boolean),
    ),
  ];
  const exportedExtras = await loadExportedNodesByNames(
    db,
    workspaceId,
    repo,
    jobId,
    calleeNames,
  );
  if (exportedExtras.length) {
    const seen = new Set(nodes.map((n) => String(n.id)));
    for (const n of exportedExtras) {
      if (!seen.has(String(n.id))) {
        seen.add(String(n.id));
        nodes.push(n);
      }
    }
  }

  const built = await buildCallsEdgesFromSites({
    workspaceId,
    repo,
    indexJobId: jobId,
    indexGenerationId: resolveJobIndexGenerationId(job),
    nodes,
    callSites,
    importBindings,
    importEdges,
    repoFiles: allPaths.length ? allPaths : batchPaths,
  });

  // Always OR IGNORE — resume from mid-shard must not die on UNIQUE/FK races.
  // Orphan AST ids are filtered inside insertDepEdgesWithSql (no whole-job FK abort).
  const insertResult = await insertDepEdgesOrIgnore(env, built.edges);

  const nextShard = shardIndex + 1;
  const complete = nextShard >= totalShards;
  const callsWritten = await countCallsEdgesForJob(env, jobId);
  const filesDone = Math.min(allPaths.length, nextShard * CALLS_BACKFILL_FILES_PER_SHARD);

  return {
    complete,
    next_shard_index: nextShard,
    next_file_offset: filesDone,
    total_files: allPaths.length,
    total_shards: totalShards,
    calls_written: callsWritten,
    batch_calls: built.counts.calls_written,
    calls_inserted: insertResult.inserted,
    calls_unresolved: built.counts.calls_unresolved,
    calls_ambiguous: built.counts.calls_ambiguous,
    calls_dynamic_skipped: built.counts.calls_dynamic_skipped,
  };
}

/**
 * Pump Level-2 calls backfill until complete or wall budget.
 */
export async function pumpCallsEdgesBackfill(env, runId, opts = {}) {
  const id = String(runId || '').trim();
  if (!env?.DB || !id) return { ok: false, error: 'run_id_required' };

  const job = await env.DB.prepare(
    `SELECT id, workspace_id, repo_full_name, status, symbol_summary, dependency_summary
       FROM agentsam_code_index_job WHERE id = ? LIMIT 1`,
  )
    .bind(id)
    .first();
  if (!job?.id) return { ok: false, error: 'run_not_found' };

  let summary = {};
  try {
    summary = job.symbol_summary != null ? JSON.parse(String(job.symbol_summary)) : {};
  } catch {
    summary = {};
  }
  const stage = String(summary.stage || '');
  const allowPump =
    summary.activated === true ||
    stage === 'active' ||
    stage === 'calls_backfill' ||
    summary.readiness === 'imports_ready';
  if (!allowPump) {
    return { ok: false, error: 'run_not_ready_for_calls', run_id: id };
  }

  const shards = await ensureCallGraphShards(env, id);
  if (!shards.ok) {
    // No sidecar → imports-only is a valid terminal Level-2 outcome (not a stall).
    if (shards.error === 'call_graph_sidecar_missing') {
      summary = {
        ...summary,
        calls_written: 0,
        stages: {
          ...(summary.stages && typeof summary.stages === 'object' ? summary.stages : {}),
          calls_backfill: {
            at: new Date().toISOString(),
            ok: true,
            shard_index: 0,
            total_shards: 0,
            total_files: 0,
            calls_written: 0,
            sidecar_missing: true,
          },
        },
      };
      await env.DB.prepare(
        `UPDATE agentsam_code_index_job SET symbol_summary = ?, updated_at = unixepoch() WHERE id = ?`,
      )
        .bind(JSON.stringify(summary), id)
        .run()
        .catch(() => null);
      return {
        ok: true,
        complete: true,
        run_id: id,
        calls_written: 0,
        total_files: 0,
        total_shards: 0,
        sidecar_missing: true,
      };
    }
    return { ok: false, error: shards.error || 'call_graph_sidecar_missing', run_id: id };
  }

  let shardIndex = Math.max(
    0,
    Number(opts.shardIndex) || Number(summary?.stages?.calls_backfill?.shard_index) || 0,
  );
  let dep = {};
  try {
    dep = job.dependency_summary != null ? JSON.parse(String(job.dependency_summary)) : {};
  } catch {
    dep = {};
  }
  const wallBudgetMs = Math.min(55_000, Math.max(8_000, Number(opts.wallBudgetMs) || 40_000));
  const t0 = Date.now();
  let last = null;

  // Checkpoint immediately so the UI can show real progress (not a stuck toast).
  summary = {
    ...summary,
    stages: {
      ...(summary.stages && typeof summary.stages === 'object' ? summary.stages : {}),
      calls_backfill: {
        at: new Date().toISOString(),
        ok: false,
        shard_index: shardIndex,
        total_shards: shards.shard_count,
        total_files: shards.file_count,
        calls_written: Number(summary.calls_written) || 0,
        soft_skipped: null,
      },
    },
  };
  await env.DB.prepare(
    `UPDATE agentsam_code_index_job SET symbol_summary = ?, updated_at = unixepoch() WHERE id = ?`,
  )
    .bind(JSON.stringify(summary), id)
    .run()
    .catch(() => null);

  // One shard per pump loop iteration max memory; lean per-shard D1 loads inside chunk.
  const maxShardsPerPump = Math.min(8, Math.max(1, Number(opts.maxShardsPerPump) || 3));
  let shardsDone = 0;

  while (Date.now() - t0 < wallBudgetMs && shardsDone < maxShardsPerPump) {
    try {
      last = await backfillCallsEdgesChunk(env, job, {
        shardIndex,
        shards,
      });
    } catch (chunkErr) {
      // Never mark a near-complete full index failed on one shard — checkpoint + resume.
      const msg = String(chunkErr?.message || chunkErr || 'calls_shard_failed').slice(0, 400);
      console.error('[calls-backfill] shard_error', id, shardIndex, msg);
      summary = {
        ...summary,
        stages: {
          ...(summary.stages && typeof summary.stages === 'object' ? summary.stages : {}),
          calls_backfill: {
            at: new Date().toISOString(),
            ok: false,
            shard_index: shardIndex,
            total_shards: shards.shard_count,
            total_files: shards.file_count,
            calls_written: Number(summary.calls_written) || 0,
            soft_error: msg,
          },
        },
      };
      await env.DB.prepare(
        `UPDATE agentsam_code_index_job
            SET status = 'idle', last_error = ?, symbol_summary = ?, updated_at = unixepoch(),
                finished_at = NULL
          WHERE id = ?`,
      )
        .bind(msg, JSON.stringify(summary), id)
        .run()
        .catch(() => null);
      return {
        ok: true,
        complete: false,
        resume: true,
        soft_error: msg,
        run_id: id,
        next_shard_index: shardIndex,
        calls_written: Number(summary.calls_written) || 0,
        total_shards: shards.shard_count,
      };
    }
    if (last.error && last.complete) {
      return { ok: false, error: last.error, run_id: id };
    }
    shardIndex = last.next_shard_index;
    shardsDone += 1;
    summary = {
      ...summary,
      calls_written: last.calls_written,
      stages: {
        ...(summary.stages && typeof summary.stages === 'object' ? summary.stages : {}),
        calls_backfill: {
          at: new Date().toISOString(),
          ok: last.complete === true,
          shard_index: shardIndex,
          total_shards: last.total_shards,
          file_offset: last.next_file_offset,
          total_files: last.total_files,
          calls_written: last.calls_written,
          soft_skipped: null,
        },
      },
    };
    dep = {
      ...dep,
      calls_written: last.calls_written,
      relationship_quality:
        last.calls_written > 0
          ? 'imports_and_calls_v1'
          : dep.relationship_quality || 'imports_v1',
    };
    await env.DB.prepare(
      `UPDATE agentsam_code_index_job
          SET symbol_summary = ?, dependency_summary = ?, updated_at = unixepoch()
        WHERE id = ?`,
    )
      .bind(JSON.stringify(summary), JSON.stringify(dep), id)
      .run()
      .catch(() => null);

    if (last.complete) {
      return {
        ok: true,
        complete: true,
        run_id: id,
        calls_written: last.calls_written,
        total_files: last.total_files,
        total_shards: last.total_shards,
      };
    }
  }

  return {
    ok: true,
    complete: false,
    resume: true,
    run_id: id,
    next_shard_index: shardIndex,
    next_file_offset: last?.next_file_offset || 0,
    calls_written: last?.calls_written || 0,
    total_files: last?.total_files || shards.file_count,
    total_shards: shards.shard_count,
  };
}
