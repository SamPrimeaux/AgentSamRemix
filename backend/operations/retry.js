/**
 * Generic "don't silently drop a failed write" retry pattern.
 *
 * Harvested from agent/harvest-agentsamfast-gold's queue/consumer.ts
 * (deleted branch) -- stripped of its Cloudflare Queue MessageBatch/ack/retry
 * API so it can wrap ANY async I/O, not just a queue consumer: a fetch to an
 * external API, a D1 write, a job step. The original's actual pattern was
 * good and worth keeping: track attempt state in D1 so a crash mid-retry is
 * recoverable, and back off exponentially instead of hammering a failing
 * dependency.
 *
 * NOT WIRED to anything. No consumer, no queue binding, no caller yet.
 *
 * If this ends up wrapping something reporting into agentsam_operations
 * (backend/operations/repository.js), call recordStep() with the outcome so
 * the two stay visible together -- don't let this track its own separate
 * status silently next to the operations ledger.
 */

/** @param {number} attempts @param {{ baseSeconds?: number, capSeconds?: number }} [opts] */
export function retryDelaySeconds(attempts, opts = {}) {
  const base = opts.baseSeconds ?? 30;
  const cap = opts.capSeconds ?? 3600;
  return Math.min(cap, base * Math.max(1, 2 ** Math.max(0, attempts - 1)));
}

/**
 * Run `fn`, recording attempt/status in the given D1 table before and after.
 * Table must have columns: id, status, attempts, last_error, updated_at
 * (started_at/completed_at optional -- set only if present, mirroring the
 * approach in backend/agentsam/approvals/queue.js's column-detection).
 *
 * @param {any} env
 * @param {{ table: string, id: string }} record
 * @param {() => Promise<{ ok: boolean, failed?: number } | void>} fn
 * @returns {Promise<{ ok: boolean, retryAfterSeconds?: number, error?: string }>}
 */
export async function runWithRetryTracking(env, record, fn) {
  if (!env?.DB) throw new Error('DB not configured');
  const { table, id } = record;

  const row = await env.DB.prepare(`SELECT attempts FROM ${table} WHERE id = ?`).bind(id).first().catch(() => null);
  const attempts = Number(row?.attempts || 0) + 1;

  await env.DB.prepare(
    `UPDATE ${table} SET status = 'processing', attempts = ?, updated_at = unixepoch() WHERE id = ?`,
  )
    .bind(attempts, id)
    .run()
    .catch(() => {});

  try {
    const receipt = await fn();
    if (receipt && typeof receipt === 'object' && Number(receipt.failed || 0) > 0) {
      throw new Error(`partial_failure:${receipt.failed}`);
    }
    await env.DB.prepare(
      `UPDATE ${table} SET status = 'completed', last_error = NULL, updated_at = unixepoch() WHERE id = ?`,
    )
      .bind(id)
      .run();
    return { ok: true };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 1000);
    await env.DB.prepare(
      `UPDATE ${table} SET status = 'failed', last_error = ?, updated_at = unixepoch() WHERE id = ?`,
    )
      .bind(message, id)
      .run()
      .catch(() => {});
    return { ok: false, retryAfterSeconds: retryDelaySeconds(attempts), error: message };
  }
}
