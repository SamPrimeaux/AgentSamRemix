/**
 * Beta / Thompson sampling math for agentsam_routing_arms.
 */
import { applyTtftPenaltyToAlpha, TTFT_INTERACTIVE_PENALTY_MS } from '../exec-context-tier.js';
import { resolveThompsonArmTaskType } from './resolve-model-task-types.js';

export { TTFT_INTERACTIVE_PENALTY_MS };

function boxMullerNormal() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Gamma(shape, scale=1) sample — Marsaglia–Tsang, shape >= 1; boosts shape<1 */
function randomGamma(shape) {
  const s = Number(shape) || 0;
  if (s <= 0) return 0;
  if (s < 1) return randomGamma(s + 1) * Math.pow(Math.random(), 1 / s);
  const d = s - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = boxMullerNormal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Draw ~ Beta(a,b) via independent Gammas */
export function sampleBeta(a, b) {
  const aa = Math.max(1e-9, Number(a) || 1);
  const bb = Math.max(1e-9, Number(b) || 1);
  const x = randomGamma(aa);
  const y = randomGamma(bb);
  return x / (x + y);
}

/**
 * Per-arm effective Beta parameters.
 * @param {Record<string, unknown>} row
 * @param {Set<string>} cols
 */
function effectiveBetaParams(row, cols) {
  const s =
    cols.has('success_count') ? Number(row.success_count)
      : cols.has('successes') ? Number(row.successes)
        : null;
  const f =
    cols.has('failure_count') ? Number(row.failure_count)
      : cols.has('failures') ? Number(row.failures)
        : null;

  if (s != null && Number.isFinite(s) && f != null && Number.isFinite(f)) {
    return { alpha: 1 + Math.max(0, s), beta: 1 + Math.max(0, f) };
  }

  if (cols.has('alpha') && cols.has('beta')) {
    return {
      alpha: Math.max(1e-9, Number(row.alpha) || 1),
      beta: Math.max(1e-9, Number(row.beta) || 1),
    };
  }

  return { alpha: 1, beta: 1 };
}

/**
 * Thompson sample: one Beta draw per arm, pick argmax.
 * @returns {{ arm: Record<string, unknown> | null, samples: number }}
 */
export function thompsonSelectArm(arms, cols) {
  if (!arms?.length) return { arm: null, samples: 0 };
  let best = null;
  let bestDraw = -1;
  for (const row of arms) {
    const { alpha, beta } = effectiveBetaParams(row, cols);
    const draw = sampleBeta(alpha, beta);
    if (draw > bestDraw) {
      bestDraw = draw;
      best = row;
    }
  }
  return { arm: best, samples: arms.length };
}

/**
 * Cold-start: blend `agentsam_model_routing_memory.success_rate` into Beta priors (in-memory copy only).
 * Interactive modes (agent/ask): TTFT penalty when avg_latency_ms exceeds threshold.
 */
export async function mergeModelRoutingMemoryPriors(env, workspaceId, taskType, arms, mode = 'agent') {
  if (!env?.DB || !arms?.length) return arms;
  const tt = resolveThompsonArmTaskType(taskType != null ? taskType : 'agent');
  const md = String(mode || 'agent').trim().toLowerCase();
  const out = [];
  for (const arm of arms) {
    const mk = String(arm.model_key ?? '').trim();
    if (!mk) {
      out.push(arm);
      continue;
    }
    let row = null;
    try {
      row = await env.DB
        .prepare(
          `SELECT success_rate, avg_latency_ms, avg_cost_usd, code_pass_rate, hallucination_rate, sample_n
           FROM agentsam_model_routing_memory
           WHERE COALESCE(TRIM(workspace_id), '') = '' AND task_type = ? AND model_key = ?
           LIMIT 1`,
        )
        .bind(tt, mk)
        .first();
    } catch {
      row = null;
    }
    if (!row || row.success_rate == null) {
      out.push(arm);
      continue;
    }
    const sr = Math.max(0.05, Math.min(0.95, Number(row.success_rate) || 0.5));
    const pseudo = 12;
    const succ = Math.max(0, Math.round(sr * pseudo));
    const fail = Math.max(0, pseudo - succ);
    let successAlpha = Math.max(1e-6, Number(arm.success_alpha ?? 1) + succ);
    const successBeta = Math.max(1e-6, Number(arm.success_beta ?? 1) + fail);

    const penalized = applyTtftPenaltyToAlpha(successAlpha, {
      mode: md,
      sampleN: row.sample_n,
      avgLatencyMs: row.avg_latency_ms,
    });
    if (penalized !== successAlpha) {
      console.info(
        '[routing] ttft_penalty_applied',
        JSON.stringify({
          model_key: mk,
          task_type: tt,
          mode: md,
          avg_latency_ms: row.avg_latency_ms,
          sample_n: row.sample_n,
        }),
      );
      successAlpha = penalized;
    }

    out.push({
      ...arm,
      success_alpha: successAlpha,
      success_beta: successBeta,
    });
  }
  return out;
}
