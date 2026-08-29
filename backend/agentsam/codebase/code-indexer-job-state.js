/**
 * Code indexer — job columns, checkpoints, manifest slim/sidecar, carry-forward, skip invariants.
 */
import { runCodeIndexPgQuery } from './code-index-write-pipe.js';
import {
  resolveCodeIndexLaneConfig,
  requireCodeIndexLaneConfig,
} from './code-index-lane-resolve.js';
import {
  FULL_INDEX_PIPELINE,
  STRUCTURAL_PARSER_ID,
  normalizeCodeIndexMode,
} from './codebase-full-index.js';
import { rollupJobStructuralQuality } from './codebase-structural-quality-rollup.js';
import { recordCodeIndexTerminalOutcome } from './code-index-terminal-log.js';
import { upsertCodeIndexJobFiles } from './code-index-job-files.js';
import { nowUnix, notifyCodeIndexJobTerminal } from './code-indexer-shared.js';

export const MANIFEST_CHECKPOINT_SOFT_MAX_BYTES = 1_500_000;

export async function loadJobColumns(env) {
  const cols = await env.DB.prepare(`PRAGMA table_info(agentsam_code_index_job)`)
    .all()
    .catch(() => ({ results: [] }));
  return new Set((cols.results || []).map((r) => String(r.name).toLowerCase()));
}

export async function patchJob(env, jobId, patch, cols) {
  const entries = Object.entries(patch).filter(([k]) => cols.has(k.toLowerCase()));
  if (!entries.length) return;
  const nextStatus = patch.status != null ? String(patch.status) : null;
  // Stop must stick: never revive cancelled via idle/running checkpoint patches.
  const protectCancel =
    nextStatus === 'idle' || nextStatus === 'running' || nextStatus === 'queued';
  const setParts = entries.map(([k]) => {
    if (protectCancel && k === 'status') {
      return `status = CASE WHEN status = 'cancelled' THEN status ELSE ? END`;
    }
    return `${k} = ?`;
  });
  const binds = entries.map(([, v]) => v);
  if (cols.has('updated_at') && !patch.updated_at) {
    await env.DB.prepare(
      `UPDATE agentsam_code_index_job SET ${setParts.join(', ')}, updated_at = unixepoch() WHERE id = ?`,
    )
      .bind(...binds, jobId)
      .run();
  } else {
    await env.DB.prepare(`UPDATE agentsam_code_index_job SET ${setParts.join(', ')} WHERE id = ?`)
      .bind(...binds, jobId)
      .run();
  }

  // Terminal outcomes → real PWA push (completed / failed / cancelled).
  // Must await: Workers can tear down the isolate before a void push finishes
  // (events row written, phone never rings).
  const terminal = String(nextStatus || '').toLowerCase();
  if (terminal === 'completed' || terminal === 'failed' || terminal === 'cancelled') {
    const detail = patch.last_error != null ? String(patch.last_error) : null;
    try {
      await notifyCodeIndexJobTerminal(env, jobId, terminal, detail);
    } catch (e) {
      console.warn('[code-indexer] terminal_notify_await_failed', e?.message || e);
    }
  }
}

export function parseJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function fullStageSummary(job, patch = {}) {
  const prior = parseJsonObject(job?.symbol_summary, {});
  return {
    pipeline: FULL_INDEX_PIPELINE,
    run_id: String(job.id),
    stage: prior.stage || 'queued',
    readiness: prior.readiness || 'building',
    structural_quality: prior.structural_quality || 'pending',
    parser_id: STRUCTURAL_PARSER_ID,
    stages: prior.stages && typeof prior.stages === 'object' ? prior.stages : {},
    ...prior,
    ...patch,
    mode: normalizeCodeIndexMode(patch.mode || prior.mode || 'full'),
  };
}

export async function carryForwardPriorArtifacts(env, opts) {
  await resolveCodeIndexLaneConfig(env);
  const { chunks: chunksTable, symbols: symbolsTable } = requireCodeIndexLaneConfig(env).tables;
  const workspaceId = String(opts.workspaceId || '');
  const workspaceUuid = String(opts.workspaceUuid || '');
  const repoFullName = String(opts.repoFullName || '');
  const priorJobId = String(opts.priorJobId || '');
  const newJobId = String(opts.newJobId || '');
  const exclude = [
    ...new Set(
      [...(opts.excludePaths || [])]
        .map((p) => (p != null ? String(p).trim() : ''))
        .filter(Boolean),
    ),
  ];
  if (!workspaceId || !workspaceUuid || !repoFullName || !priorJobId || !newJobId) {
    throw new Error('carry_forward_args_invalid');
  }

  // D1 max bound params is ~100 — never NOT IN / IN the full exclude set.
  // Carry every prior node, then drop changed/removed paths in small batches.
  const D1_IN_CHUNK = 40;
  let d1Carried = 0;
  let d1Dropped = 0;
  try {
    const upd = await env.DB.prepare(
      `UPDATE codebase_ast_nodes
          SET index_job_id = ?, updated_at = unixepoch()
        WHERE workspace_id = ? AND repo_full_name = ? AND index_job_id = ?`,
    )
      .bind(newJobId, workspaceId, repoFullName, priorJobId)
      .run();
    d1Carried = Number(upd?.meta?.changes ?? upd?.changes ?? 0) || 0;
  } catch (e) {
    throw new Error(`carry_forward_d1_relink:${String(e?.message || e).slice(0, 200)}`);
  }
  for (let i = 0; i < exclude.length; i += D1_IN_CHUNK) {
    const chunk = exclude.slice(i, i + D1_IN_CHUNK);
    const ph = chunk.map(() => '?').join(',');
    try {
      const del = await env.DB.prepare(
        `DELETE FROM codebase_ast_nodes
          WHERE workspace_id = ? AND repo_full_name = ? AND index_job_id = ?
            AND file_path IN (${ph})`,
      )
        .bind(workspaceId, repoFullName, newJobId, ...chunk)
        .run();
      d1Dropped += Number(del?.meta?.changes ?? del?.changes ?? 0) || 0;
    } catch (e) {
      throw new Error(
        `carry_forward_d1_exclude_chunk:${i}:${chunk.length}:${String(e?.message || e).slice(0, 180)}`,
      );
    }
  }

  // PG: relink all prior run_id rows, then delete exclude paths in chunks (no giant ANY()).
  const chunkRelink = await runCodeIndexPgQuery(
    env,
    `UPDATE agentsam.${chunksTable}
          SET metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                '{run_id}',
                to_jsonb($4::text),
                true
              )
        WHERE workspace_id = $1::uuid
          AND COALESCE(metadata->>'repo_full_name', '') = $2
          AND COALESCE(metadata->>'run_id', '') = $3`,
    [workspaceUuid, repoFullName, priorJobId, newJobId],
  );
  if (!chunkRelink.ok) {
    throw new Error(`carry_forward_chunks_relink:${chunkRelink.error || 'failed'}`);
  }
  const symbolRelink = await runCodeIndexPgQuery(
    env,
    `UPDATE agentsam.${symbolsTable}
          SET metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                '{run_id}',
                to_jsonb($4::text),
                true
              ),
              updated_at = now()
        WHERE workspace_id = $1::uuid
          AND repo_full_name = $2
          AND COALESCE(metadata->>'run_id', '') = $3`,
    [workspaceUuid, repoFullName, priorJobId, newJobId],
  );
  if (!symbolRelink.ok) {
    throw new Error(`carry_forward_symbols_relink:${symbolRelink.error || 'failed'}`);
  }
  for (let i = 0; i < exclude.length; i += D1_IN_CHUNK) {
    const chunk = exclude.slice(i, i + D1_IN_CHUNK);
    const delChunks = await runCodeIndexPgQuery(
      env,
      `DELETE FROM agentsam.${chunksTable}
        WHERE workspace_id = $1::uuid
          AND COALESCE(metadata->>'repo_full_name', '') = $2
          AND COALESCE(metadata->>'run_id', '') = $3
          AND file_path = ANY($4::text[])`,
      [workspaceUuid, repoFullName, newJobId, chunk],
    );
    if (!delChunks.ok) {
      throw new Error(`carry_forward_chunks_exclude:${i}:${delChunks.error || 'failed'}`);
    }
    const delSymbols = await runCodeIndexPgQuery(
      env,
      `DELETE FROM agentsam.${symbolsTable}
        WHERE workspace_id = $1::uuid
          AND repo_full_name = $2
          AND COALESCE(metadata->>'run_id', '') = $3
          AND file_path = ANY($4::text[])`,
      [workspaceUuid, repoFullName, newJobId, chunk],
    );
    if (!delSymbols.ok) {
      throw new Error(`carry_forward_symbols_exclude:${i}:${delSymbols.error || 'failed'}`);
    }
  }

  return {
    ok: true,
    d1_nodes_carried: Math.max(0, d1Carried - d1Dropped),
    d1_nodes_relinked: d1Carried,
    d1_nodes_dropped: d1Dropped,
    exclude_count: exclude.length,
    carry_forward_batching: 'v2_chunk40',
  };
}

export function shouldSkipUnchangedFile(input) {
  return Boolean(
    input?.blobMatch &&
      Number(input.chunks) > 0 &&
      Number(input.symbols) > 0 &&
      input.parserMatch !== false,
  );
}

export function compactCallSites(sites) {
  if (!Array.isArray(sites) || !sites.length) return [];
  return sites.map((s) => ({
    line: s.line,
    callee_name: s.callee_name,
    member_path: s.member_path || null,
    dynamic: !!s.dynamic,
    enclosing_node_id: s.enclosing_node_id,
    enclosing_name: s.enclosing_name || null,
    enclosing_line_start: s.enclosing_line_start || null,
  }));
}

export function compactImportBindings(bindings) {
  if (!Array.isArray(bindings) || !bindings.length) return [];
  return bindings.map((b) => ({
    local: b.local,
    imported: b.imported,
    specifier: b.specifier,
    line: b.line || null,
    re_export: !!b.re_export,
  }));
}

export function normalizeManifestInPlace(manifest) {
  if (!manifest || typeof manifest !== 'object') return manifest;
  const lists = [manifest.files, manifest.excluded_sample];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const f of list) {
      if (!f || typeof f !== 'object') continue;
      delete f.revision_sha;
      if (Array.isArray(f.call_sites)) f.call_sites = compactCallSites(f.call_sites);
      if (Array.isArray(f.import_bindings)) f.import_bindings = compactImportBindings(f.import_bindings);
    }
  }
  return manifest;
}

const MANIFEST_FILE_D1_KEYS = [
  'path',
  'classification',
  'size_bytes',
  'language',
  'extension',
  'git_blob_sha',
  'file_hash',
  'sha',
  'status',
  'parser_id',
  'structural_quality',
  'error',
  'chunks_written',
  'symbols_written',
  'chunks_relinked',
  'symbols_relinked',
  'vectorize_soft_fails',
  'chat_rag_lane',
];

export function slimFileEntryForD1(file) {
  if (!file || typeof file !== 'object') return file;
  const out = {};
  for (const k of MANIFEST_FILE_D1_KEYS) {
    if (file[k] != null && file[k] !== '') out[k] = file[k];
  }
  if (file.path != null) out.path = String(file.path);
  if (out.error != null) out.error = String(out.error).slice(0, 300);
  return out;
}

export function slimManifestForD1(manifest) {
  if (!manifest || typeof manifest !== 'object') return manifest;
  return {
    ...manifest,
    files: Array.isArray(manifest.files) ? manifest.files.map(slimFileEntryForD1) : [],
    excluded_sample: Array.isArray(manifest.excluded_sample)
      ? manifest.excluded_sample.slice(0, 40).map(slimFileEntryForD1)
      : [],
  };
}

export function slimReceiptsForSummary(receipts) {
  if (!Array.isArray(receipts)) return [];
  return receipts.slice(-40).map((r) => {
    if (!r || typeof r !== 'object') return r;
    const out = {
      path: r.path,
      status: r.status,
    };
    if (r.error != null) out.error = String(r.error).slice(0, 300);
    if (r.git_blob_sha) out.git_blob_sha = r.git_blob_sha;
    if (r.chunks_relinked != null) out.chunks_relinked = r.chunks_relinked;
    if (r.symbols_relinked != null) out.symbols_relinked = r.symbols_relinked;
    if (r.chunks_written != null) out.chunks_written = r.chunks_written;
    if (r.vectorize_soft_fails != null) out.vectorize_soft_fails = r.vectorize_soft_fails;
    return out;
  });
}

export function slimSymbolSummaryForD1(summary) {
  if (!summary || typeof summary !== 'object') return summary;
  const stages = { ...(summary.stages || {}) };
  const pc = stages.parse_chunks;
  if (pc && typeof pc === 'object') {
    stages.parse_chunks = {
      ...pc,
      latest_receipts: slimReceiptsForSummary(pc.latest_receipts),
      receipts: Array.isArray(pc.receipts) ? slimReceiptsForSummary(pc.receipts) : pc.receipts,
    };
  }
  return { ...summary, stages };
}

export async function loadJobStructuralQualityRollup(env, jobId) {
  const id = String(jobId || '').trim();
  if (!id || !env?.DB) {
    return rollupJobStructuralQuality({}, { rolled_up_at: new Date().toISOString() });
  }
  const rows = await env.DB.prepare(
    `SELECT COALESCE(structural_quality, '(null)') AS q, COUNT(*) AS n
       FROM agentsam_code_index_job_file
      WHERE index_job_id = ?
      GROUP BY 1`,
  )
    .bind(id)
    .all()
    .then((r) => r?.results || [])
    .catch(() => []);
  /** @type {Record<string, number>} */
  const byQuality = {};
  for (const row of rows) {
    byQuality[String(row.q)] = Math.max(0, Number(row.n) || 0);
  }
  let parseFailedPaths = [];
  if ((byQuality.parse_failed || 0) > 0) {
    parseFailedPaths = await env.DB.prepare(
      `SELECT path FROM agentsam_code_index_job_file
        WHERE index_job_id = ? AND structural_quality = 'parse_failed'
        ORDER BY path LIMIT 10`,
    )
      .bind(id)
      .all()
      .then((r) => (r?.results || []).map((x) => String(x.path || '')).filter(Boolean))
      .catch(() => []);
  }
  return rollupJobStructuralQuality(byQuality, {
    parse_failed_paths: parseFailedPaths,
    rolled_up_at: new Date().toISOString(),
  });
}

export function callGraphSidecarKey(jobId) {
  return `agentsam/code-index/${String(jobId || '').trim()}/call_graph.json`;
}

export function extractCallGraphFromManifest(manifest) {
  /** @type {Record<string, { call_sites: object[], import_bindings: object[] }>} */
  const files = {};
  for (const f of Array.isArray(manifest?.files) ? manifest.files : []) {
    const path = f?.path != null ? String(f.path) : '';
    if (!path) continue;
    const cs = Array.isArray(f.call_sites) ? f.call_sites : [];
    const ib = Array.isArray(f.import_bindings) ? f.import_bindings : [];
    if (!cs.length && !ib.length) continue;
    files[path] = { call_sites: cs, import_bindings: ib };
  }
  return files;
}

export async function persistCallGraphSidecar(env, jobId, manifest) {
  const bucket = env?.ARTIFACTS || env?.ASSETS;
  if (!bucket?.put) return { ok: false, reason: 'no_r2' };
  const id = String(jobId || '').trim();
  if (!id) return { ok: false, reason: 'no_job' };
  const files = extractCallGraphFromManifest(manifest);
  const body = JSON.stringify({
    job_id: id,
    updated_at: nowUnix(),
    file_count: Object.keys(files).length,
    files,
  });
  await bucket.put(callGraphSidecarKey(id), body, {
    httpMetadata: { contentType: 'application/json' },
  });
  return { ok: true, bytes: body.length, files: Object.keys(files).length };
}

export async function hydrateCallGraphOntoManifest(env, jobId, manifest) {
  if (!manifest || !Array.isArray(manifest.files) || !manifest.files.length) return manifest;
  const already = manifest.files.some(
    (f) =>
      (Array.isArray(f?.call_sites) && f.call_sites.length) ||
      (Array.isArray(f?.import_bindings) && f.import_bindings.length),
  );
  if (already) return manifest;
  const bucket = env?.ARTIFACTS || env?.ASSETS;
  if (!bucket?.get) return manifest;
  const obj = await bucket.get(callGraphSidecarKey(jobId)).catch(() => null);
  if (!obj) return manifest;
  let parsed;
  try {
    parsed = JSON.parse(await obj.text());
  } catch {
    return manifest;
  }
  const byPath = parsed?.files && typeof parsed.files === 'object' ? parsed.files : {};
  for (const f of manifest.files) {
    const path = f?.path != null ? String(f.path) : '';
    const side = path ? byPath[path] : null;
    if (!side) continue;
    if (Array.isArray(side.call_sites)) f.call_sites = side.call_sites;
    if (Array.isArray(side.import_bindings)) f.import_bindings = side.import_bindings;
  }
  return manifest;
}

/**
 * @param {any} env
 * @param {string} jobId
 * @param {object} manifest
 * @param {{ persistFilesOnly?: object[]|null, inventoryStamp?: boolean }} [opts]
 */
export async function serializeManifestForD1(env, jobId, manifest, opts = {}) {
  normalizeManifestInPlace(manifest);
  try {
    await persistCallGraphSidecar(env, jobId, manifest);
  } catch (e) {
    console.warn('[code-indexer] call_graph_sidecar_failed', e?.message || e);
  }
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const persistSubset = Array.isArray(opts.persistFilesOnly) ? opts.persistFilesOnly : null;
  let filesToUpsert =
    persistSubset && persistSubset.length
      ? persistSubset
      : opts.inventoryStamp === false
        ? []
        : files;
  // Crawl stamps ~2k rows once. Re-upserting the full inventory on every checkpoint hop
  // was the 38% D1 hog — skip when job_file already matches file_count.
  if (
    filesToUpsert.length > 50 &&
    !persistSubset &&
    opts.inventoryStamp !== false &&
    env?.DB
  ) {
    try {
      const expect = Math.max(
        Number(manifest.files_count) || 0,
        files.length,
        Number(
          (
            await env.DB.prepare(
              `SELECT file_count FROM agentsam_code_index_job WHERE id = ? LIMIT 1`,
            )
              .bind(String(jobId))
              .first()
          )?.file_count,
        ) || 0,
      );
      if (expect > 0) {
        const have = await env.DB.prepare(
          `SELECT COUNT(*) AS c FROM agentsam_code_index_job_file WHERE index_job_id = ?`,
        )
          .bind(String(jobId))
          .first()
          .catch(() => null);
        if (Number(have?.c) >= expect) filesToUpsert = [];
      }
    } catch (e) {
      console.warn('[code-indexer] job_file_inventory_skip_check_failed', e?.message || e);
    }
  }
  if (filesToUpsert.length && env?.DB) {
    try {
      const meta = await env.DB.prepare(
        `SELECT workspace_id, repo_full_name, index_generation_id FROM agentsam_code_index_job WHERE id = ? LIMIT 1`,
      )
        .bind(String(jobId))
        .first()
        .catch(() => null);
      const workspaceId = String(meta?.workspace_id || '').trim();
      const repoFullName = String(
        meta?.repo_full_name || manifest.repo_full_name || manifest.repo || '',
      ).trim();
      if (workspaceId && repoFullName) {
        await upsertCodeIndexJobFiles(env, {
          jobId: String(jobId),
          workspaceId,
          repo_full_name: repoFullName,
          indexGenerationId:
            meta?.index_generation_id ||
            manifest.index_generation_id ||
            `legacy:${jobId}`,
          files: filesToUpsert,
          inventoryStamp: !(persistSubset && persistSubset.length),
        });
      }
    } catch (e) {
      console.warn('[code-indexer] job_file_upsert_failed', e?.message || e);
    }
  }
  const header = slimManifestForD1(manifest);
  header.files = [];
  header.files_table = 'agentsam_code_index_job_file';
  header.files_count = files.length;
  const json = JSON.stringify(header);
  if (json.length >= MANIFEST_CHECKPOINT_SOFT_MAX_BYTES) {
    const err = new Error(
      `manifest_checkpoint_soft_limit:bytes=${json.length}:limit=${MANIFEST_CHECKPOINT_SOFT_MAX_BYTES}`,
    );
    err.code = 'manifest_checkpoint_soft_limit';
    err.manifestBytes = json.length;
    throw err;
  }
  return json;
}

export async function isJobCancelled(env, jobId) {
  const live = await env.DB.prepare(
    `SELECT status, symbol_summary FROM agentsam_code_index_job WHERE id = ? LIMIT 1`,
  )
    .bind(jobId)
    .first()
    .catch(() => null);
  if (String(live?.status || '') === 'cancelled') return true;
  // Sticky cancel flag survives status races until resume clears it.
  try {
    const summary =
      live?.symbol_summary != null ? JSON.parse(String(live.symbol_summary)) : null;
    if (summary?.cancel_requested === true) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export async function patchCheckpoint(env, jobId, patch, cols) {
  if (await isJobCancelled(env, jobId)) {
    return { cancelled: true };
  }
  const next = { ...patch };
  if (next.status === 'idle') {
    const names = Object.keys(next).filter((k) => cols.has(k));
    if (!names.length) return { cancelled: false };
    const sets = names.map((k) => {
      if (k === 'status') return `status = CASE WHEN status = 'cancelled' THEN status ELSE ? END`;
      return `${k} = ?`;
    });
    const binds = names.map((k) => next[k]);
    await env.DB.prepare(
      `UPDATE agentsam_code_index_job SET ${sets.join(', ')}, updated_at = unixepoch() WHERE id = ?`,
    )
      .bind(...binds, jobId)
      .run();
    if (await isJobCancelled(env, jobId)) return { cancelled: true };
    return { cancelled: false };
  }
  await patchJob(env, jobId, next, cols);
  if (await isJobCancelled(env, jobId)) return { cancelled: true };
  return { cancelled: false };
}

export function embedSymbolsSkipInvariant(input) {
  const relinked = Number(input?.symbols_relinked_estimate) || 0;
  const skipped = Number(input?.skipped_already_embedded) || 0;
  if (relinked <= 0) {
    return {
      ok: true,
      checked: false,
      reason: 'no_relinked_symbols',
      symbols_relinked_estimate: relinked,
      skipped_already_embedded: skipped,
    };
  }
  if (skipped >= relinked) {
    return {
      ok: true,
      checked: true,
      symbols_relinked_estimate: relinked,
      skipped_already_embedded: skipped,
    };
  }
  return {
    ok: false,
    checked: true,
    reason: 'embed_double_bill_suspected',
    symbols_relinked_estimate: relinked,
    skipped_already_embedded: skipped,
  };
}

export function mergeRemovedPaths(explicitRemoved, setDiffRemoved) {
  const out = new Set();
  for (const list of [explicitRemoved, setDiffRemoved]) {
    if (!list) continue;
    for (const p of list) {
      const s = String(p || '')
        .trim()
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (s) out.add(s);
    }
  }
  return [...out].sort();
}

export async function logFullIndexTerminal(env, input) {
  try {
    await recordCodeIndexTerminalOutcome(env, input);
  } catch (e) {
    console.warn('[code-indexer] terminal_log', e?.message ?? e);
  }
}

