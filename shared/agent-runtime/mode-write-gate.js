/**
 * Hard Ask/Plan write contracts — Cursor-parity autonomy sliders.
 * validateToolCall is the sole mutate gate; this module is the pure policy core.
 *
 * Law: Ask + Plan never mutate. Agent may mutate subject to write_policy + capabilities.
 * Mutation classification comes from D1 capabilityDecision only — no tool-name heuristics.
 */

import { materializeWritePolicyFlags } from '../../shared/agent-runtime/tool-capability-policy.js';

/** @typedef {import('./runtime-profile.types.js').RuntimeWritePolicy} RuntimeWritePolicy */

const HARD_READONLY_MODES = new Set(['ask', 'plan']);

/**
 * @param {unknown} mode
 */
export function isHardReadonlyMode(mode) {
  return HARD_READONLY_MODES.has(String(mode || '').trim().toLowerCase());
}

/**
 * @param {RuntimeWritePolicy|null|undefined} writePolicy
 */
export function writePolicyAllowsAnyMutation(writePolicy) {
  const wp = writePolicy && typeof writePolicy === 'object' ? writePolicy : {};
  return (
    wp.can_edit_files === true ||
    wp.can_terminal === true ||
    wp.can_d1_write === true ||
    wp.can_deploy === true ||
    wp.can_browser_automation === true ||
    wp.can_memory_write === true ||
    wp.can_postgres_write === true ||
    wp.can_postgres_migrate === true ||
    wp.can_send_email === true
  );
}

/**
 * Seal Ask/Plan write_policy — never inherit a writable overlay.
 * @param {string} mode
 * @param {RuntimeWritePolicy|null|undefined} writePolicy
 * @returns {RuntimeWritePolicy}
 */
export function sealWritePolicyForMode(mode, writePolicy) {
  const m = String(mode || '').trim().toLowerCase();
  // Ask/Plan: hard seal deny — mode law, not a JS capability grant menu.
  if (isHardReadonlyMode(m)) {
    return {
      can_edit_files: false,
      can_terminal: false,
      can_d1_write: false,
      can_deploy: false,
      can_browser_automation: false,
      can_memory_write: false,
      can_postgres_write: false,
      can_postgres_migrate: false,
      can_send_email: false,
    };
  }
  // Agent/Debug/Multitask: D1 write_policy_json only. Missing/empty → fail closed.
  return /** @type {RuntimeWritePolicy} */ (materializeWritePolicyFlags(writePolicy));
}

/**
 * Sole mutate gate for composer modes (pure).
 * Classification SSOT: capabilityDecision from agentsam_tool_capabilities / agentsam_capabilities.
 * @param {{
 *   mode?: string|null,
 *   write_policy?: RuntimeWritePolicy|null,
 *   toolName: string,
 *   capabilityDecision?: {
 *     decision?: string,
 *     reason?: string,
 *     mutating_capabilities?: string[],
 *     unclassified?: boolean,
 *     unclassified_mutation?: boolean,
 *   }|null,
 * }} input
 * @returns {{ allowed: boolean, reason: string }}
 */
export function assertModeWriteGate(input) {
  const mode = String(input.mode || '').trim().toLowerCase();
  const wp = sealWritePolicyForMode(mode, input.write_policy);
  const readonlyMode = isHardReadonlyMode(mode);
  const cap = input.capabilityDecision || null;
  const capMutating =
    Array.isArray(cap?.mutating_capabilities) && cap.mutating_capabilities.length > 0;
  const capDenied = cap?.decision === 'deny';
  const unclassifiedMutation = cap?.unclassified_mutation === true;
  const unclassified = cap?.unclassified === true;
  const hasCapabilityDecision = cap != null && typeof cap === 'object';

  // Fail closed: Ask/Plan require a D1 capability decision. No name-heuristic fallback.
  if (readonlyMode && !hasCapabilityDecision) {
    return {
      allowed: false,
      reason: `blocked by ${mode || 'readonly'} write_policy: capability_decision_required`,
    };
  }

  if (readonlyMode && (capMutating || unclassifiedMutation || unclassified)) {
    return {
      allowed: false,
      reason: `blocked by ${mode || 'readonly'} write_policy: mutations require Agent or Debug`,
    };
  }

  if (!writePolicyAllowsAnyMutation(wp) && (capMutating || unclassifiedMutation)) {
    return {
      allowed: false,
      reason: 'blocked by write_policy: no mutate flags enabled',
    };
  }

  if (capDenied) {
    return {
      allowed: false,
      reason: `blocked by capability policy: ${cap?.reason || 'deny'}`,
    };
  }

  return { allowed: true, reason: 'mode_write_gate_ok' };
}
