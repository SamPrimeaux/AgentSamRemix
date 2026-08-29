/**
 * Map agentsam_error_log into terminal Problems rows.
 * Never includes secret values — error_message only (operational errors).
 *
 * SSOT: agentsam_error_log only (no tool_call / audit / worker overlays).
 */

/** Dedupe window for incident rows sharing the same message. */
export const PROBLEM_DEDUPE_WINDOW_SEC = 5;

/** Hidden from terminal Problems panel; still returned in raw error_log for Overview/Analytics. */
const TERMINAL_PANEL_HIDDEN_ERROR_TYPES = new Set(['db_write_failure']);

/** Telemetry that still writes agentsam_error_log, but is not a Problems source. */
const TERMINAL_PANEL_HIDDEN_SOURCES = new Set([
  'terminal_assist',
  'worker_fetch',
  'worker_analytics_events',
]);

/** Prefer this source when multiple rows share the same incident key. */
const CANONICAL_ERROR_SOURCE_PRIORITY = [
  'agentsam_tool_chain',
  'agentsam_tool_call_log',
  'agentsam_agent_run',
];

/** @param {unknown} source */
function isToolCallLogErrorSource(source) {
  return String(source || '').trim() === 'agentsam_tool_call_log';
}

/** @param {number | string | null | undefined} ts */
export function formatProblemTimestamp(ts) {
  if (ts == null || ts === '') return '';
  const n = Number(ts);
  if (Number.isFinite(n) && n > 1e9 && n < 1e12) {
    try {
      return new Date(n * 1000).toISOString().slice(0, 19).replace('T', ' ');
    } catch {
      return String(ts);
    }
  }
  return String(ts);
}

/** @param {number | string | null | undefined} ts */
function problemUnixSec(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return 0;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

/** @param {string} msg */
function normalizeProblemMessage(msg) {
  return String(msg || '')
    .trim()
    .slice(0, 500)
    .toLowerCase();
}

/**
 * @param {string} source
 */
function sourcePriority(source) {
  const s = String(source || '').trim();
  const idx = CANONICAL_ERROR_SOURCE_PRIORITY.indexOf(s);
  return idx >= 0 ? idx : CANONICAL_ERROR_SOURCE_PRIORITY.length;
}

/**
 * One row per incident (same message within PROBLEM_DEDUPE_WINDOW_SEC); prefers agentsam_tool_chain.
 * @param {Record<string, unknown>[]} rows
 */
export function dedupeErrorLogRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const sorted = [...rows].sort((a, b) => problemUnixSec(b.created_at) - problemUnixSec(a.created_at));
  const kept = [];
  const buckets = [];

  for (const row of sorted) {
    const msg = normalizeProblemMessage(row.error_message);
    const ts = problemUnixSec(row.created_at);
    let merged = false;
    for (const bucket of buckets) {
      if (bucket.msg !== msg) continue;
      if (Math.abs(bucket.ts - ts) > PROBLEM_DEDUPE_WINDOW_SEC) continue;
      if (sourcePriority(row.source) < sourcePriority(bucket.row.source)) {
        bucket.row = row;
        bucket.ts = ts;
      }
      merged = true;
      break;
    }
    if (!merged) {
      buckets.push({ msg, ts, row });
    }
  }

  for (const bucket of buckets) {
    kept.push(bucket.row);
  }
  kept.sort((a, b) => problemUnixSec(b.created_at) - problemUnixSec(a.created_at));
  return kept;
}

/**
 * Drop agentsam_tool_call_log rows already mirrored into agentsam_error_log
 * (source=agentsam_tool_call_log, or error_log_id set on the call row).
 * @param {Record<string, unknown>[]} errorLogRows
 * @param {Record<string, unknown>[]} toolCallRows
 */
export function filterToolCallErrorsNotMirrored(errorLogRows, toolCallRows) {
  if (!Array.isArray(toolCallRows) || !toolCallRows.length) return [];
  const log = Array.isArray(errorLogRows) ? errorLogRows : [];
  const mirroredIds = new Set(
    log
      .filter((r) => isToolCallLogErrorSource(r.source))
      .filter((r) => r.source_id != null)
      .map((r) => String(r.source_id)),
  );
  const mirroredKeys = new Set(
    log
      .filter((r) => isToolCallLogErrorSource(r.source))
      .map((r) => `${normalizeProblemMessage(r.error_message)}:${problemUnixSec(r.created_at)}`),
  );

  return toolCallRows.filter((row) => {
    if (row.error_log_id != null && String(row.error_log_id).trim() !== '') return false;
    const id = row.id != null ? String(row.id) : '';
    if (id && mirroredIds.has(id)) return false;
    const key = `${normalizeProblemMessage(row.error_message || row.status)}:${problemUnixSec(row.created_at_unix ?? row.created_at)}`;
    if (mirroredKeys.has(key)) return false;
    return true;
  });
}

/** @deprecated Use filterToolCallErrorsNotMirrored — mcp execution is no longer a Problems source. */
export function filterMcpToolErrorsNotMirrored(errorLogRows, mcpRows) {
  return filterToolCallErrorsNotMirrored(errorLogRows, mcpRows);
}

/**
 * @param {Record<string, unknown>[]} errorLogRows
 * @param {{ surface?: 'terminal' | 'overview' }} [opts]
 */
export function filterErrorLogForProblemsSurface(errorLogRows, opts = {}) {
  if (!Array.isArray(errorLogRows)) return [];
  const surface = opts.surface === 'overview' ? 'overview' : 'terminal';
  let rows = errorLogRows;
  if (surface === 'terminal') {
    rows = rows.filter((row) => {
      if (TERMINAL_PANEL_HIDDEN_ERROR_TYPES.has(String(row.error_type || '').trim())) return false;
      if (TERMINAL_PANEL_HIDDEN_SOURCES.has(String(row.source || '').trim())) return false;
      return true;
    });
  }
  return dedupeErrorLogRows(rows);
}

/**
 * @param {string} source
 * @param {Record<string, unknown>} row
 */
function problemFileLabel(source, row) {
  const s = String(source || 'agentsam_error_log');
  if (s === 'agentsam_tool_chain' || s === 'agentsam_tool_call_log') {
    let tool = '';
    try {
      const ctx = row.context_json != null ? JSON.parse(String(row.context_json)) : null;
      if (ctx && typeof ctx === 'object' && ctx.tool_key != null) tool = String(ctx.tool_key);
    } catch {
      /* ignore */
    }
    return tool ? `tool · ${tool}` : 'tool';
  }
  const code = row.error_code != null ? String(row.error_code) : '';
  return code ? `${s} · ${code}` : s;
}

/**
 * @param {Record<string, unknown>[]} errorLogRows
 * @returns {{ file: string, line: number, msg: string, severity: 'error' | 'warning', ts?: string, id?: string }[]}
 */
export function mapErrorLogToProblems(errorLogRows) {
  if (!Array.isArray(errorLogRows)) return [];
  return errorLogRows.map((row) => {
    const severityRaw = String(row.error_type || row.severity || 'error').toLowerCase();
    const severity = severityRaw.includes('warn') ? 'warning' : 'error';
    const source = String(row.source || 'agentsam_error_log');
    const ts = formatProblemTimestamp(row.created_at);
    return {
      file: problemFileLabel(source, row),
      line: 0,
      msg: String(row.error_message || 'Unknown error').slice(0, 500),
      severity,
      ts,
      id: row.id != null ? String(row.id) : undefined,
    };
  });
}

/**
 * @param {{ error_log?: Record<string, unknown>[], agentsam_error_log?: Record<string, unknown>[] }} payload
 * @param {{ surface?: 'terminal' | 'overview' }} [opts]
 */
export function buildUnifiedProblems(payload, opts = {}) {
  const rows = payload.agentsam_error_log || payload.error_log || [];
  const errorRows = filterErrorLogForProblemsSurface(rows, opts);
  return mapErrorLogToProblems(errorRows);
}
