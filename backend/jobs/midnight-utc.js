import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';
import { runMasterDailyRetention } from '../services/retention.js';
import { runSecurityScan } from '../../src/core/security-scan.js';
import {
  compactAgentsamToolCallLogToStats,
  rollupExecutionPerformanceMetrics,
  rollupOtlpTracesDaily,
  runAgentsamMemoryDecay,
} from '../../src/core/memory.js';
import { sweepStaleCronRuns } from './agent-run-sweeps.js';
import { runEtoPipeline } from '../http/agentsam/routes/ops-runtime.js';
import { archiveOldConversations } from './archive-old-conversations.js';
import { runVelocityDailyRollup } from './velocity-daily-rollup.js';
import { sendDailyDigest } from './daily-digest.js';
import { writeDailySnapshot } from './write-daily-snapshot.js';
import { scheduleAgentsamErrorLog } from '../telemetry/error-log.js';

const CRON_MIDNIGHT = '0 0 * * *';
const CRON_ONE_AM = '0 1 * * *';

/**
 * @param {any} env
 * @param {string} jobName
 * @param {string} cronExpr
 * @param {() => Promise<any>} fn
 * @param {string | null} [tenantId]
 * @param {string | null} [workspaceId]
 */
/** Map cron job return value to agentsam_cron_runs completion payload. @param {any} out */
function cronJobResultToLedgerPayload(out) {
  if (!out || typeof out !== 'object') {
    return { rowsRead: 0, rowsWritten: 0, metadata: {} };
  }
  const rowsWritten =
    Number(out.rowsWritten ?? out.totalDeleted ?? out.pruned_objects ?? 0) || 0;
  const rowsRead = Number(out.rowsRead ?? 0) || 0;
  if (out.metadata != null && typeof out.metadata === 'object') {
    return { rowsRead, rowsWritten, metadata: out.metadata };
  }
  return { rowsRead, rowsWritten, metadata: {} };
}

async function cronLedgerWrap(env, jobName, cronExpr, fn, tenantId = null, workspaceId = null) {
  const begun = await startCronRun(env, {
    jobName,
    cronExpression: cronExpr,
    tenantId,
    workspaceId,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  try {
    const out = await fn();
    if (runId) {
      await completeCronRun(env, runId, startedAt, cronJobResultToLedgerPayload(out));
    }
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    console.warn(`[cron] ${jobName}`, e?.message ?? e);
  }
}

/**
 * `0 0 * * *` UTC — retention purge, nightly rollups, archive, daily digest email (worker.js parity).
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function runMidnightUtcJobs(env, ctx) {
  if (env?.DB) {
    ctx.waitUntil(
      cronLedgerWrap(env, 'oauth_expiry_cleanup', CRON_MIDNIGHT, async () => {
        try {
          const codeSweep = await env.DB.prepare(
            `DELETE FROM oauth_authorization_codes
             WHERE expires_at IS NOT NULL AND expires_at < unixepoch()`,
          ).run();
          const oauthRefreshSweep = await env.DB.prepare(
            `DELETE FROM mcp_workspace_tokens
             WHERE token_type = 'oauth'
               AND refresh_expires_at IS NOT NULL
               AND refresh_expires_at < unixepoch()`,
          ).run();
          const tokenSweep = await env.DB.prepare(
            `DELETE FROM mcp_workspace_tokens
             WHERE (token_type IS NULL OR token_type != 'oauth' OR refresh_expires_at IS NULL)
               AND expires_at IS NOT NULL
               AND expires_at < unixepoch()`,
          ).run();
          const authSweep = await env.DB.prepare(
            `DELETE FROM oauth_authorizations
             WHERE expires_at IS NOT NULL
               AND expires_at < unixepoch()
               AND status IN ('pending','denied','expired')`,
          ).run();
          const refreshSweep = await env.DB.prepare(
            `DELETE FROM oauth_refresh_tokens
             WHERE expires_at IS NOT NULL AND expires_at < unixepoch()`,
          ).run();
          const nonceSweep = await env.DB.prepare(
            `DELETE FROM oauth_state_nonces
             WHERE expires_at IS NOT NULL AND expires_at < unixepoch()`,
          ).run();
          const rowsWritten =
            (Number(codeSweep?.meta?.changes) || 0) +
            (Number(oauthRefreshSweep?.meta?.changes) || 0) +
            (Number(tokenSweep?.meta?.changes) || 0) +
            (Number(authSweep?.meta?.changes) || 0) +
            (Number(refreshSweep?.meta?.changes) || 0) +
            (Number(nonceSweep?.meta?.changes) || 0);
          console.log(
            '[cron] oauth expiry cleanup',
            JSON.stringify({
              oauth_authorization_codes_deleted: Number(codeSweep?.meta?.changes) || 0,
              mcp_oauth_refresh_expired_deleted: Number(oauthRefreshSweep?.meta?.changes) || 0,
              mcp_workspace_tokens_deleted: Number(tokenSweep?.meta?.changes) || 0,
              oauth_authorizations_deleted: Number(authSweep?.meta?.changes) || 0,
              oauth_refresh_tokens_deleted: Number(refreshSweep?.meta?.changes) || 0,
              oauth_state_nonces_deleted: Number(nonceSweep?.meta?.changes) || 0,
            }),
          );
          return {
            rowsRead: 6,
            rowsWritten,
            metadata: {
              oauth_authorization_codes_deleted: Number(codeSweep?.meta?.changes) || 0,
              mcp_oauth_refresh_expired_deleted: Number(oauthRefreshSweep?.meta?.changes) || 0,
              mcp_workspace_tokens_deleted: Number(tokenSweep?.meta?.changes) || 0,
              oauth_authorizations_deleted: Number(authSweep?.meta?.changes) || 0,
              oauth_refresh_tokens_deleted: Number(refreshSweep?.meta?.changes) || 0,
              oauth_state_nonces_deleted: Number(nonceSweep?.meta?.changes) || 0,
            },
          };
        } catch (e) {
          scheduleAgentsamErrorLog(env, ctx, {
            workspaceId:
              typeof env?.WORKSPACE_ID === 'string' && env.WORKSPACE_ID.trim()
                ? env.WORKSPACE_ID.trim()
                : 'system',
            tenantId:
              typeof env?.TENANT_ID === 'string' && env.TENANT_ID.trim()
                ? env.TENANT_ID.trim()
                : 'system',
            sessionId: null,
            errorCode: 'oauth_expiry_cleanup_failed',
            errorType: 'scheduled_cron',
            errorMessage: e?.message != null ? String(e.message) : String(e),
            source: 'oauth_expiry_cleanup',
            sourceId: CRON_MIDNIGHT,
            contextJson: JSON.stringify({
              cron: CRON_MIDNIGHT,
              task: 'oauth_expiry_cleanup',
            }),
          });
          throw e;
        }
      }),
    );
    ctx.waitUntil(
      cronLedgerWrap(env, 'master_daily_retention', CRON_MIDNIGHT, () => runMasterDailyRetention(env)),
    );
    ctx.waitUntil(
      cronLedgerWrap(env, 'close_stale_work_sessions', CRON_MIDNIGHT, async () => {
        const res = await env.DB.prepare(`
          UPDATE work_sessions
          SET ended_at = unixepoch()
          WHERE ended_at IS NULL
            AND started_at < unixepoch() - 86400
        `).run().catch(() => null);
        return {
          rowsRead: 0,
          rowsWritten: Number(res?.meta?.changes) || 0,
          metadata: {
            work_sessions_closed: Number(res?.meta?.changes) || 0,
          },
        };
      }),
    );
    ctx.waitUntil(
      cronLedgerWrap(env, 'security_scan_nightly', CRON_MIDNIGHT, () =>
        runSecurityScan(env, {
          tenantId: env.TENANT_ID ?? 'system',
          triggeredBy: 'nightly_cron',
        }),
      ),
    );
    ctx.waitUntil(
      cronLedgerWrap(env, 'agentsam_cron_runs_stuck_sweep', CRON_MIDNIGHT, () =>
        sweepStaleCronRuns(env, { cronExpression: CRON_MIDNIGHT, skipLedger: true }),
      ),
    );
    ctx.waitUntil(
      cronLedgerWrap(env, 'velocity_daily_rollup', CRON_MIDNIGHT, () => runVelocityDailyRollup(env)),
    );
  }
  if (env?.DB && env?.R2) {
    ctx.waitUntil(
      archiveOldConversations(env).then((r) => {
        console.log('[archive]', JSON.stringify(r));
      }),
    );
  }
  if (!env?.DB) return;
  const today = new Date().toISOString().slice(0, 10);
  const already = await env.DB.prepare(
    `SELECT id FROM email_logs
     WHERE subject LIKE '%Daily Digest%'
     AND created_at >= ? LIMIT 1`,
  )
    .bind(`${today}T00:00:00`)
    .first()
    .catch(() => null);
  if (already) return;
  ctx.waitUntil(writeDailySnapshot(env, 'cron_midnight').catch(() => {}));
  ctx.waitUntil(sendDailyDigest(env));
}

/**
 * `0 1 * * *` — agentsam memory decay + tool stats (matches former src/index.js scheduled).
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export function scheduleOneAmMaintenance(env, ctx) {
  if (!env?.DB) return;
  ctx.waitUntil(
    cronLedgerWrap(env, 'agentsam_memory_decay', CRON_ONE_AM, () =>
      runAgentsamMemoryDecay(env).catch((e) => {
        console.warn('[cron] agentsam_memory decay', e?.message ?? e);
        throw e;
      }),
    ),
  );
  ctx.waitUntil(
    cronLedgerWrap(env, 'tool_call_log_compact', CRON_ONE_AM, () =>
      compactAgentsamToolCallLogToStats(env).catch((e) => {
        console.warn('[cron] tool_stats_compacted', e?.message ?? e);
        throw e;
      }),
    ),
  );
  ctx.waitUntil(
    cronLedgerWrap(env, 'execution_performance_rollup', CRON_ONE_AM, async () => {
      await rollupExecutionPerformanceMetrics(env).catch((e) => {
        console.warn('[cron] agentsam_execution_performance_metrics', e?.message ?? e);
        throw e;
      });
      await runEtoPipeline(env).catch((e) => {
        console.warn('[cron] agentsam_performance_eto_events', e?.message ?? e);
        throw e;
      });
    }),
  );
  ctx.waitUntil(
    cronLedgerWrap(env, 'otlp_traces_rollup_daily', CRON_ONE_AM, () =>
      rollupOtlpTracesDaily(env).catch((e) => {
        console.warn('[cron] otlp_traces rollup', e?.message ?? e);
        throw e;
      }),
    ),
  );
  ctx.waitUntil(
    cronLedgerWrap(env, 'code_index_runner', CRON_ONE_AM, async () => {
      const { runCodeIndexCronStep } = await import('./code-index-runner.js');
      return runCodeIndexCronStep(env).catch((e) => {
        console.warn('[cron] code_index_runner', e?.message ?? e);
        throw e;
      });
    }),
  );
}
