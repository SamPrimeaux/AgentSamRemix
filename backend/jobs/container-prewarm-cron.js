/**
 * Optional MY_CONTAINER keep-warm (~25m cadence; sleepAfter is 30m).
 *
 * DEFAULT OFF — prewarm was burning idle container memory/disk ($/GiB-sec) even
 * when nobody used the sandbox for days. Enable only when actively using sandbox:
 *   1. CONTAINER_PREWARM_ENABLED=1  (wrangler var / secret)
 *   2. Re-add CRON_CONTAINER_PREWARM to wrangler.production.toml [triggers] crons
 *
 * The handler remains wired in scheduled.js; production currently omits the trigger
 * so this job does not wake the Worker every 25 minutes.
 *
 * When off: first agentsam_terminal_sandbox / container exec cold-starts after sleep.
 * Uses the same tryContainerExec path as /api/internal/my-container/exec.
 * MyContainer.sleepAfter is 2m — keep prewarm cadence longer than that if enabling.
 */
import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';
import { resolveCronWorkspaceId } from './cron-tenant.js';
import { notifyOperator } from './notify-operator.js';
import { resolveContainerPoolId, tryContainerExec } from '../agentsam/sandbox/my-container.js';

export const CRON_CONTAINER_PREWARM = '*/25 * * * *';
const PREWARM_COMMAND = 'echo container_prewarm_ok';
const CONSECUTIVE_FAILURE_ALERT = 2;

/** @param {any} env */
export function isContainerPrewarmEnabled(env) {
  const raw = String(env?.CONTAINER_PREWARM_ENABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * @param {any} env
 * @param {{ error: string, durationMs?: number, poolId?: string }} detail
 */
async function writeContainerPrewarmErrorLog(env, detail) {
  if (!env?.DB) return;
  const workspaceId = (await resolveCronWorkspaceId(env)) || null;
  if (!workspaceId) return;
  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_error_log
         (workspace_id, tenant_id, session_id, error_type, error_message, source, created_at)
       VALUES (?,?,?,?,?,?,unixepoch())`,
    )
      .bind(
        workspaceId,
        'system',
        null,
        'container_prewarm_failed',
        String(detail.error || 'unknown').slice(0, 1000),
        'container_prewarm_cron',
      )
      .run();
  } catch (e) {
    console.warn('[cron] container_prewarm error_log', e?.message ?? e);
  }
}

/**
 * @param {any} env
 */
async function lastPrewarmRunFailed(env) {
  if (!env?.DB) return false;
  const row = await env.DB.prepare(
    `SELECT metadata_json FROM agentsam_cron_runs
     WHERE job_name = 'container_prewarm' AND status = 'completed'
     ORDER BY started_at DESC LIMIT 1`,
  )
    .first()
    .catch(() => null);
  if (!row?.metadata_json) return false;
  try {
    const meta = JSON.parse(String(row.metadata_json));
    return meta?.ok === false;
  } catch {
    return false;
  }
}

/**
 * @param {any} env
 * @param {ExecutionContext} [ctx]
 */
export async function runContainerPrewarmCron(env, ctx) {
  const poolId = resolveContainerPoolId(env);
  const platformWorkspaceId = await resolveCronWorkspaceId(env);
  if (!platformWorkspaceId) {
    return { ok: false, skipped: true, reason: 'platform_d1_workspace_id_required' };
  }
  const begun = await startCronRun(env, {
    jobName: 'container_prewarm',
    cronExpression: CRON_CONTAINER_PREWARM,
    tenantId: null,
    workspaceId: platformWorkspaceId,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();

  if (!isContainerPrewarmEnabled(env)) {
    const metadata = {
      ok: true,
      skipped: true,
      reason: 'prewarm_disabled',
      pool_id: poolId,
      hint: 'Set CONTAINER_PREWARM_ENABLED=1 to keep MY_CONTAINER warm (costs GiB-sec while live).',
    };
    if (runId) await completeCronRun(env, runId, startedAt, { rowsRead: 0, rowsWritten: 0, metadata });
    return metadata;
  }

  if (!env?.MY_CONTAINER?.getByName) {
    const metadata = { ok: false, skipped: true, reason: 'container_unbound', pool_id: poolId };
    if (runId) await completeCronRun(env, runId, startedAt, { rowsRead: 0, rowsWritten: 0, metadata });
    return metadata;
  }

  try {
    const t0 = Date.now();
    const out = await tryContainerExec(env, {
      command: PREWARM_COMMAND,
      cwd: '/tmp',
      timeout_ms: 10_000,
    });
    const durationMs = Date.now() - t0;
    const ok = out?.ok === true && !out?.error;
    const metadata = {
      ok,
      pool_id: poolId,
      duration_ms: durationMs,
      error: ok ? null : String(out?.error || 'prewarm_failed').slice(0, 400),
      stdout: String(out?.stdout || '').trim().slice(0, 120) || null,
    };

    if (!ok) {
      console.warn('[cron] container_prewarm failed', metadata.error, metadata);
      await writeContainerPrewarmErrorLog(env, {
        error: metadata.error,
        durationMs,
        poolId,
      });
      const priorFailed = await lastPrewarmRunFailed(env);
      if (priorFailed) {
        await notifyOperator(
          env,
          {
            category: 'container_prewarm',
            subject: 'CF Container pre-warm failed twice (scheduler may be stuck)',
            body: [
              'The inneranimalmedia MY_CONTAINER pre-warm cron failed twice in a row.',
              '',
              `Pool: ${poolId}`,
              `Error: ${metadata.error}`,
              `Duration: ${durationMs}ms`,
              '',
              'Sandbox MCP (agentsam_terminal_sandbox) will likely timeout until the container scheduler recovers.',
              'Use agentsam_terminal_remote for git/shell until resolved.',
              '',
              'Check: wrangler containers instances list, CF dashboard MY_CONTAINER instances.',
            ].join('\n'),
          },
          ctx ?? null,
        );
      }
    } else if (durationMs > 30_000) {
      console.warn('[cron] container_prewarm slow', durationMs, 'ms');
    }

    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead: 0,
        rowsWritten: ok ? 1 : 0,
        metadata,
      });
    }
    return metadata;
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    console.warn('[cron] container_prewarm', e?.message ?? e);
    throw e;
  }
}
