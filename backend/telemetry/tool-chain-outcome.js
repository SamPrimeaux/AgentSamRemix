/**
 * Semantic outcome for lean agentsam_tool_chain (infra tool_status stays separate).
 * Deterministic from execErr / tool body — not model prose.
 */

const CODEMODE_TOOL_NAME = 'codemode';

/** @typedef {'direct'|'wrapper'|'nested'} ToolChainExecutionRole */

/**
 * Read-time role — do not store (AGENTS.md §4).
 * @param {{ toolKey?: unknown, parentChainId?: unknown }} row
 * @returns {ToolChainExecutionRole}
 */
export function toolChainExecutionRole(row = {}) {
  const parent = row?.parentChainId ?? row?.parent_chain_id ?? null;
  if (parent != null && String(parent).trim() !== '') return 'nested';
  const key = String(row?.toolKey ?? row?.tool_key ?? '')
    .trim()
    .toLowerCase();
  if (key === CODEMODE_TOOL_NAME) return 'wrapper';
  return 'direct';
}

/**
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeToolChainParentId(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s.startsWith('atc_')) return null;
  return s.slice(0, 120);
}

/**
 * @returns {string}
 */
export function newToolChainId() {
  return `atc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** @typedef {'ok'|'soft_fail'|'error'} ToolChainOutcome */
/** @typedef {'host_error'|'sandbox_error'|'exit_nonzero'|'empty_result'|'nested_fail'|'dispatch_error'|'ok'} ToolChainOutcomeReason */

const RANK = { ok: 0, soft_fail: 1, error: 2 };

/**
 * @param {ToolChainOutcome|null|undefined} a
 * @param {ToolChainOutcome|null|undefined} b
 * @returns {ToolChainOutcome}
 */
export function worseOutcome(a, b) {
  const aa = a === 'error' || a === 'soft_fail' || a === 'ok' ? a : 'ok';
  const bb = b === 'error' || b === 'soft_fail' || b === 'ok' ? b : 'ok';
  return RANK[aa] >= RANK[bb] ? aa : bb;
}

/**
 * @param {unknown} body
 * @returns {Record<string, unknown>|null}
 */
function asObject(body) {
  if (body == null) return null;
  if (typeof body === 'object' && !Array.isArray(body)) {
    return /** @type {Record<string, unknown>} */ (body);
  }
  if (typeof body === 'string') {
    try {
      const j = JSON.parse(body);
      return j && typeof j === 'object' && !Array.isArray(j) ? j : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {{
 *   execErr?: unknown,
 *   ok?: boolean|null,
 *   body?: unknown,
 *   nestedOutcomes?: Array<ToolChainOutcome|null|undefined>|null,
 * }} p
 * @returns {{ outcome: ToolChainOutcome, outcome_reason: ToolChainOutcomeReason }}
 */
export function resolveToolChainOutcome(p = {}) {
  if (p.execErr != null && p.execErr !== false) {
    return { outcome: 'error', outcome_reason: 'host_error' };
  }
  if (p.ok === false) {
    return { outcome: 'error', outcome_reason: 'dispatch_error' };
  }

  let outcome = /** @type {ToolChainOutcome} */ ('ok');
  let reason = /** @type {ToolChainOutcomeReason} */ ('ok');

  const nested = Array.isArray(p.nestedOutcomes) ? p.nestedOutcomes : [];
  for (const n of nested) {
    if (n === 'error' || n === 'soft_fail') {
      const next = worseOutcome(outcome, n);
      if (next !== outcome) {
        outcome = next;
        reason = 'nested_fail';
      }
    }
  }

  const body = asObject(p.body);
  if (body) {
    const status = body.status != null ? String(body.status).toLowerCase() : '';
    if (status === 'error' || status === 'failed') {
      return { outcome: 'error', outcome_reason: 'sandbox_error' };
    }
    if (body.ok === false || body.error != null && String(body.error).trim() !== '') {
      const exitRaw = body.exit_code ?? body.exitCode;
      const exitCode = Number(exitRaw);
      if (Number.isFinite(exitCode) && exitCode !== 0) {
        return { outcome: 'soft_fail', outcome_reason: 'exit_nonzero' };
      }
      // Non-throwing tool body with error string — soft unless status hard-failed above.
      outcome = worseOutcome(outcome, 'soft_fail');
      if (reason === 'ok') reason = 'dispatch_error';
    }
    const exitRaw = body.exit_code ?? body.exitCode;
    const exitCode = Number(exitRaw);
    if (Number.isFinite(exitCode) && exitCode !== 0) {
      outcome = worseOutcome(outcome, 'soft_fail');
      if (reason === 'ok' || reason === 'dispatch_error') reason = 'exit_nonzero';
      const matchCount = Number(body.match_count ?? body.matchCount);
      if (Number.isFinite(matchCount) && matchCount === 0) {
        reason = 'empty_result';
      }
    }
  }

  return { outcome, outcome_reason: reason };
}

/**
 * Map chain outcome → bandit auto signal + failure_category.
 * @param {ToolChainOutcome} outcome
 * @returns {{ signal_type: 'auto_success'|'auto_error', failure_category: string|null, success: boolean }}
 */
export function banditSignalFromOutcome(outcome) {
  if (outcome === 'ok') {
    return { signal_type: 'auto_success', failure_category: null, success: true };
  }
  if (outcome === 'soft_fail') {
    return { signal_type: 'auto_error', failure_category: 'tool_soft_fail', success: false };
  }
  return { signal_type: 'auto_error', failure_category: 'tool_error', success: false };
}
