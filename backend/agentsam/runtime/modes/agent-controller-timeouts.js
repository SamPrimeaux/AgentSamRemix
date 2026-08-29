/**
 * Agent-run wall-clock bounds — D1 runtime_policy_json is SSOT.
 * Defaults are last-resort only (never floor a lower D1 profile up to 180s).
 */

const DEFAULT_HARD_TIMEOUT_MS = 200_000;
const DEFAULT_TARGET_MS = 180_000;
const MIN_RUN_MS = 30_000;

/**
 * @param {any} profile
 * @returns {{ maxRunMs: number, hardTimeoutMs: number, source: string }}
 */
export function resolveAgentRunTimeoutMs(profile) {
  const policy =
    (profile?._runtime_policy && typeof profile._runtime_policy === 'object'
      ? profile._runtime_policy
      : null) ||
    (profile?.runtime_policy && typeof profile.runtime_policy === 'object'
      ? profile.runtime_policy
      : null) ||
    {};

  const hardFromPolicy = Math.floor(
    Number(policy.agent_run_hard_timeout_ms ?? policy.hard_timeout_ms) || 0,
  );
  const hardTimeoutMs =
    hardFromPolicy >= MIN_RUN_MS + 5_000 ? hardFromPolicy : DEFAULT_HARD_TIMEOUT_MS;

  const profileMs = Math.floor(
    Number(profile?.max_runtime_ms) || Number(policy.max_runtime_ms) || 0,
  );
  const targetFallback = Math.floor(Number(policy.agent_run_target_ms) || 0);
  let desired =
    profileMs > 0 ? profileMs : targetFallback > 0 ? targetFallback : DEFAULT_TARGET_MS;

  if (desired < MIN_RUN_MS) desired = MIN_RUN_MS;
  const cap = Math.max(MIN_RUN_MS, hardTimeoutMs - 5_000);
  const maxRunMs = Math.min(desired, cap);
  const source =
    profileMs > 0
      ? 'profile.max_runtime_ms'
      : targetFallback > 0
        ? 'policy.agent_run_target_ms'
        : 'default_target';

  return { maxRunMs, hardTimeoutMs, source };
}
