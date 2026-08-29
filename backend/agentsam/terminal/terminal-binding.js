/**
 * Immutable TerminalBinding receipt + mismatch guard.
 * UI Connected is only valid when requested lane matches connected host_kind.
 *
 * Field split (do not collapse):
 *   lane       local | remote | sandbox
 *   host_kind  darwin | linux | cf_container   (physical/runtime)
 *   hop target local | remote | container | sandbox  (ExecOS; not this module)
 *
 * `mac` / `gcp` are legacy hop aliases. They are not host_kind values.
 * Incoming receipts may still say mac/gcp; canonicalize before emit/compare.
 */

import { terminalLaneFromTargetType } from './execution-plan.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * ExecOS hop `target` (not host_kind, not connection target_type).
 * Canonical: local | remote | container | sandbox.
 * mac/gcp are ingest-only aliases; IAM callers should emit the canonical hop.
 * @param {unknown} value
 * @returns {'local'|'remote'|'container'|'sandbox'|null}
 */
export function canonicalizeExecHopTarget(value) {
  const s = trim(value).toLowerCase();
  if (!s) return null;
  if (s === 'local' || s === 'mac') return 'local';
  if (s === 'remote' || s === 'gcp') return 'remote';
  if (s === 'container') return 'container';
  if (s === 'sandbox') return 'sandbox';
  return null;
}

/**
 * Canonical physical host_kind. Never returns mac|gcp.
 * @param {unknown} value
 * @returns {'darwin'|'linux'|'cf_container'|null}
 */
export function canonicalizeHostKind(value) {
  const s = trim(value).toLowerCase();
  if (!s) return null;
  if (s === 'darwin' || s === 'mac') return 'darwin';
  if (s === 'linux' || s === 'gcp') return 'linux';
  if (s === 'cf_container') return 'cf_container';
  return null;
}

/**
 * Expected host_kind for a lane when the origin omitted host_kind.
 * Guard only — origin-provided host_kind wins after canonicalize.
 * @param {string|null|undefined} targetLane
 * @param {string|null|undefined} targetType
 */
export function hostKindForTerminalLane(targetLane, targetType = null) {
  const lane = trim(targetLane || terminalLaneFromTargetType(targetType) || '');
  if (lane === 'local') return 'darwin';
  if (lane === 'remote') return 'linux';
  if (lane === 'sandbox') return 'cf_container';
  return null;
}

/**
 * @param {string|null|undefined} targetLane
 * @param {string|null|undefined} transport
 */
export function transportForBinding(targetLane, transport = null) {
  const t = trim(transport);
  if (t) return t;
  const lane = trim(targetLane);
  if (lane === 'local') return 'cloudflare_tunnel';
  if (lane === 'remote') return 'vpc';
  if (lane === 'sandbox') return 'container_ws';
  return null;
}

/**
 * @param {Record<string, unknown>} plan
 * @param {{
 *   host_kind?: string|null,
 *   transport?: string|null,
 *   cwd?: string|null,
 *   target_id?: string|null,
 * }} connected
 */
export function buildTerminalBinding(plan, connected = {}) {
  const targetType = trim(plan?.target_type) || null;
  const lane = trim(plan?.target_lane || terminalLaneFromTargetType(targetType) || '') || null;
  const fromOrigin = canonicalizeHostKind(connected.host_kind);
  const hostKind = fromOrigin || hostKindForTerminalLane(lane, targetType);
  return {
    protocol: trim(plan?.protocol || 'pty') || 'pty',
    lane,
    target_type: targetType,
    target_id: trim(connected.target_id || plan?.target_id) || null,
    host_kind: hostKind,
    transport: transportForBinding(lane, connected.transport || plan?.transport),
    workspace_id: trim(plan?.workspace_id) || null,
    cwd: trim(connected.cwd || plan?.cwd) || null,
  };
}

/**
 * @param {{ lane?: string|null, target_type?: string|null, host_kind?: string|null }} requested
 * @param {{ lane?: string|null, target_type?: string|null, host_kind?: string|null }} connected
 */
export function assertTerminalBinding(requested, connected) {
  const reqLane = trim(requested?.lane || terminalLaneFromTargetType(requested?.target_type) || '');
  const gotLane = trim(connected?.lane || terminalLaneFromTargetType(connected?.target_type) || '');
  const reqHost =
    canonicalizeHostKind(requested?.host_kind) || hostKindForTerminalLane(reqLane);
  const gotHost = canonicalizeHostKind(connected?.host_kind);

  if (reqLane && gotLane && reqLane !== gotLane) {
    const err = new Error('TERMINAL_BINDING_MISMATCH');
    err.code = 'TERMINAL_BINDING_MISMATCH';
    err.detail = { requested: requested, connected };
    throw err;
  }
  if (reqHost && gotHost && reqHost !== gotHost) {
    const err = new Error('TERMINAL_BINDING_MISMATCH');
    err.code = 'TERMINAL_BINDING_MISMATCH';
    err.detail = { requested: requested, connected };
    throw err;
  }
  return true;
}
