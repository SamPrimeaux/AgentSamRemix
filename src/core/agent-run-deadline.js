export const AGENT_RUN_DEADLINE_RESERVE_MS = 2500;

/**
 * Minimum viable budget per tool class — below this, a tool call is set up
 * to fail before it starts. Racing a doomed call is worse than not attempting
 * it: it burns turn time, produces a raw timeout error, and that error was
 * observed leaking directly into the visible assistant reply.
 *
 * Keyed by name prefix/exact match, checked in order; falls through to DEFAULT.
 */
const MIN_VIABLE_BUDGET_MS = [
  { test: (n) => n.startsWith('github_') || n.startsWith('agentsam_github_'), floor: 5_000 },
  { test: (n) => n.startsWith('agentsam_terminal_') || n === 'agentsam_container_exec', floor: 8_000 },
  { test: (n) => n.startsWith('r2_') || n.startsWith('agentsam_r2_'), floor: 4_000 },
  { test: (n) => n.startsWith('browser_') || n.startsWith('playwright') || n.startsWith('cdt_'), floor: 6_000 },
  { test: (n) => n === 'search_web' || n === 'web_fetch', floor: 3_000 },
  {
    test: (n) =>
      n.includes('d1_') && (n.includes('query') || n.includes('write') || n.includes('migrate')),
    floor: 2_000,
  },
  // BUGFIX 2026-07-24: imgx_* had no entry here and fell through to the 2s DEFAULT.
  // Real image-gen calls observed taking 8.4s-22.9s; sequential multi-image turns
  // were racing later calls against 5-10s of remaining budget -- guaranteed timeout,
  // not a fair attempt. 15s floor: below this, fail fast instead of racing a doomed call.
  { test: (n) => n.startsWith('imgx_'), floor: 15_000 },
];

const DEFAULT_MIN_VIABLE_BUDGET_MS = 2_000;

/**
 * @param {string} toolName
 * @returns {number}
 */
export function resolveMinViableBudgetMs(toolName) {
  const n = String(toolName || '')
    .trim()
    .toLowerCase();
  for (const rule of MIN_VIABLE_BUDGET_MS) {
    if (rule.test(n)) return rule.floor;
  }
  return DEFAULT_MIN_VIABLE_BUDGET_MS;
}

/**
 * @param {number} requestedBudgetMs
 * @param {{
 *   runStartedAt: number,
 *   maxRunMs: number,
 *   now?: number,
 *   reserveMs?: number,
 *   toolName?: string,
 * }} opts
 * @returns {number} Clamped budget in ms. Returns 0 when the run deadline is
 *   reached OR when the remaining time is below the tool's minimum viable
 *   budget (treated identically by callers — both mean "do not attempt").
 */
export function clampToolBudgetToRunDeadline(
  requestedBudgetMs,
  {
    runStartedAt,
    maxRunMs,
    now = Date.now(),
    reserveMs = AGENT_RUN_DEADLINE_RESERVE_MS,
    toolName = '',
  } = {},
) {
  const requested = Math.max(1, Math.floor(Number(requestedBudgetMs) || 1));
  const started = Number(runStartedAt);
  const runtime = Number(maxRunMs);
  if (!Number.isFinite(started) || !Number.isFinite(runtime) || runtime <= 0) {
    return requested;
  }

  const remaining = Math.floor(started + runtime - Number(now) - Math.max(0, reserveMs));
  if (remaining <= 0) return 0;

  // Fail fast instead of racing a call that structurally cannot finish in time.
  const minViable = resolveMinViableBudgetMs(toolName);
  if (remaining < minViable) return 0;

  return Math.min(requested, remaining);
}

/**
 * @param {string|null} [toolName]
 */
export function agentRunDeadlineError(toolName = null) {
  const msg = toolName
    ? `Not enough time left in this turn to run ${toolName} — the agent run deadline is close and this tool needs at least a viable window to complete. Try again in a new turn, or ask for a narrower task.`
    : 'Agent run deadline reached before tool execution';
  return Object.assign(new Error(msg), {
    code: 'agent_run_deadline',
    tool_name: toolName || null,
  });
}

export async function raceToolExecutionBudget(promise, budgetMs, toolName = 'tool') {
  const timeoutMs = Math.max(1, Math.floor(Number(budgetMs) || 1));
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(
            Object.assign(new Error(`${toolName} timed out after ${timeoutMs}ms`), {
              code: 'tool_timeout',
              tool_name: toolName,
              timeout_ms: timeoutMs,
            }),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}
