/**
 * D1 heartbeat for tree-sitter WASM init — proves isolate death vs catchable errors.
 *
 * stages.treesitter_init phases (symbol_summary):
 *   before_indexer_service_warm → about to warm IAM_CODEBASE_INDEXER (preferred)
 *   before_parser_init → about to call Parser.init (local Node only; if job dies here → WASM abort)
 *   after_parser_init  → Parser.init returned
 *   before_language_load / after_language_load
 *   ready              → runtime usable (local or indexer service)
 */

export const TREESITTER_INIT_STAGE_KEY = 'treesitter_init';

/** Phases that mean we entered WASM init and never got a success stamp. */
export const TREESITTER_WASM_SUSPECT_PHASES = new Set([
  'before_parser_init',
  'parser_init_started',
  'before_language_load',
]);

/**
 * @param {unknown} summary
 * @returns {object|null}
 */
export function readTreesitterInitStage(summary) {
  const s = summary && typeof summary === 'object' ? summary : null;
  const ti = s?.stages?.[TREESITTER_INIT_STAGE_KEY];
  return ti && typeof ti === 'object' ? ti : null;
}

/**
 * True when a prior batch stamped before WASM and never completed — reclaim would loop.
 * @param {object|null|undefined} summary
 * @param {{ indexedFileCount?: number, failedFileCount?: number }} [counters]
 */
export function isTreesitterWasmAbortSuspect(summary, counters = {}) {
  const ti = readTreesitterInitStage(summary);
  if (!ti) return false;
  if (ti.ok === true || ti.phase === 'ready' || ti.phase === 'after_parser_init') return false;
  if (ti.after_parser_init_at) return false;
  const phase = String(ti.phase || '');
  if (!TREESITTER_WASM_SUSPECT_PHASES.has(phase)) return false;
  const indexed = Number(counters.indexedFileCount) || 0;
  const failed = Number(counters.failedFileCount) || 0;
  // Only treat as WASM abort when no file progress landed (isolate death mid-init).
  return indexed === 0 && failed === 0;
}

/**
 * Merge stages.treesitter_init onto symbol_summary and bump updated_at (await before WASM).
 * @param {any} env
 * @param {string} jobId
 * @param {string} phase
 * @param {Record<string, unknown>} [extra]
 */
export async function stampTreesitterHeartbeat(env, jobId, phase, extra = {}) {
  const id = jobId != null ? String(jobId).trim() : '';
  if (!env?.DB || !id || !phase) return { ok: false, skipped: true, reason: 'no_job' };

  const row = await env.DB.prepare(
    `SELECT symbol_summary FROM agentsam_code_index_job WHERE id = ? LIMIT 1`,
  )
    .bind(id)
    .first()
    .catch(() => null);

  let summary = {};
  try {
    summary =
      row?.symbol_summary != null ? JSON.parse(String(row.symbol_summary)) : {};
  } catch {
    summary = {};
  }
  if (!summary || typeof summary !== 'object') summary = {};
  if (!summary.stages || typeof summary.stages !== 'object') summary.stages = {};

  const prior =
    summary.stages[TREESITTER_INIT_STAGE_KEY] &&
    typeof summary.stages[TREESITTER_INIT_STAGE_KEY] === 'object'
      ? summary.stages[TREESITTER_INIT_STAGE_KEY]
      : {};

  const at = new Date().toISOString();
  const next = {
    ...prior,
    ...extra,
    phase: String(phase),
    at,
    job_id: id,
  };
  if (phase === 'after_parser_init' || phase === 'ready') {
    next.ok = true;
    next.after_parser_init_at = next.after_parser_init_at || at;
  }
  if (phase === 'before_parser_init' || phase === 'parser_init_started') {
    next.ok = false;
    delete next.after_parser_init_at;
  }

  summary.stages[TREESITTER_INIT_STAGE_KEY] = next;

  await env.DB.prepare(
    `UPDATE agentsam_code_index_job
        SET symbol_summary = ?,
            updated_at = unixepoch()
      WHERE id = ?`,
  )
    .bind(JSON.stringify(summary), id)
    .run();

  return { ok: true, phase: String(phase), job_id: id };
}

/**
 * Mark job failed after WASM-suspect reclaim (no more idle→retry loop).
 * @param {any} env
 * @param {string} jobId
 * @param {object|null} summary
 */
export async function failJobTreesitterWasmAbort(env, jobId, summary) {
  const id = jobId != null ? String(jobId).trim() : '';
  if (!env?.DB || !id) return { ok: false };
  const ti = readTreesitterInitStage(summary);
  const phase = ti?.phase != null ? String(ti.phase) : 'unknown';
  const message =
    `treesitter_wasm_isolate_abort:phase=${phase}. ` +
    `Heartbeat was stamped before Parser.init/language load but the isolate died without a catchable Error. ` +
    `Do not Continue this run — Restart after a Worker-safe treesitter fix.`;

  let nextSummary = summary && typeof summary === 'object' ? { ...summary } : {};
  if (!nextSummary.stages || typeof nextSummary.stages !== 'object') nextSummary.stages = {};
  nextSummary.stage = 'failed';
  nextSummary.readiness = 'failed';
  nextSummary.stages[TREESITTER_INIT_STAGE_KEY] = {
    ...(ti || {}),
    phase: 'isolate_abort',
    ok: false,
    at: new Date().toISOString(),
    abort_detected: true,
  };
  nextSummary.failure = {
    at: new Date().toISOString(),
    error: message.slice(0, 500),
  };

  await env.DB.prepare(
    `UPDATE agentsam_code_index_job
        SET status = 'failed',
            last_error = ?,
            symbol_summary = ?,
            finished_at = unixepoch(),
            updated_at = unixepoch()
      WHERE id = ?
        AND status IN ('idle','running')`,
  )
    .bind(message.slice(0, 500), JSON.stringify(nextSummary), id)
    .run();

  return { ok: true, error: message, run_id: id };
}
