/**
 * Single entry for Worker `scheduled()` — maps `event.cron` to lifted jobs (worker.js parity).
 * See `./matrix.js` for expression → handler reference.
 */
import { runIntegritySnapshot } from '../../src/api/integrity.js';
import { runMidnightUtcJobs } from './midnight-utc.js';
import { runFinancialCommandCron } from './financial-command-cron.js';
import { sendDailyPlanEmail } from './daily-plan-email.js';
import {
  CRON_DAILY_EVOLUTION,
  runDailyEvolutionCuratorCron,
} from './daily-evolution-curator-cron.js';
import { runWeeklyRollup } from './weekly-rollup.js';
import { runWebhookWeeklyRollupCron } from './webhook-rollups.js';
import { runCodebaseIndexWeeklyHealthCron } from './codebase-index-weekly-health.js';
import { runFirstOfMonthJobs } from './first-of-month.js';
import { writeDailySnapshot } from './write-daily-snapshot.js';
import { runThirtyMinuteJobs, runHourlyRoutingJobs } from './thirty-minute-cron.js';
import { runContainerPrewarmCron } from './container-prewarm-cron.js';
import {
  CRON_MESHY_CAD_SAFETY,
  runMeshyCadReconcileJobs,
} from './meshy-cad-reconcile-cron.js';
import { runWebhookEventsRepairCron } from './webhook-events-repair.js';
import { compactAgentsamToolCallLogToStats, rollupOtlpTracesDaily } from '../../src/core/memory.js';
import { rollupWorkerAnalytics } from '../telemetry/worker-analytics-rollup.js';
import { runOneAmCompactionPipeline } from './one-am-compaction-pipeline.js';
import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';
import { runWaeErrorSpikeCheck } from './wae-error-spike-check.js';
import { runApprovalNotifyCron } from './approval-notify-sweep.js';


const CRON_ONE_AM = '0 1 * * *';
const CRON_FIVE_MINUTE = '*/5 * * * *';
/** High-frequency slots — no "Execution starting" line unless the slot itself logs work. */
const QUIET_CRON_START = new Set([CRON_FIVE_MINUTE, '*/20 * * * *', '*/30 * * * *']);

/** @param {any} out */
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

async function cronLedgerWrap(env, jobName, cronExpr, fn) {
  const begun = await startCronRun(env, {
    jobName,
    cronExpression: cronExpr,
    tenantId: null,
    workspaceId: null,
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
 * `0 1 * * *` — unified compaction pipeline, webhook stuck-received repair, worker analytics, MCP tool stats, OTLP rollup.
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
function scheduleOneAmMaintenance(env, ctx) {
  if (!env?.DB) return;
  ctx.waitUntil(runWebhookEventsRepairCron(env));
  ctx.waitUntil(
    cronLedgerWrap(env, 'rollup_worker_analytics', CRON_ONE_AM, () =>
      rollupWorkerAnalytics(env).catch((e) => {
        console.warn('[cron] rollup_worker_analytics', e?.message ?? e);
        throw e;
      }),
    ),
  );
  ctx.waitUntil(
    cronLedgerWrap(env, 'one_am_compaction_pipeline', CRON_ONE_AM, () =>
      runOneAmCompactionPipeline(env).catch((e) => {
        console.warn('[cron] one_am_compaction_pipeline', e?.message ?? e);
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
    cronLedgerWrap(env, 'otlp_traces_rollup_daily', CRON_ONE_AM, () =>
      rollupOtlpTracesDaily(env).catch((e) => {
        console.warn('[cron] otlp_traces rollup', e?.message ?? e);
        throw e;
      }),
    ),
  );
  // Standalone memory decay (also runs after 6am RAG chain — ledger here so hangs upstream cannot skip it).
  ctx.waitUntil(
    cronLedgerWrap(env, 'agentsam_memory_decay', CRON_ONE_AM, async () => {
      const { runAgentsamMemoryDecay } = await import('../../src/core/memory.js');
      return runAgentsamMemoryDecay(env);
    }),
  );
  // Live 1 AM slot — midnight-utc.js also defines scheduleOneAmMaintenance but
  // this file's function is the one `0 1 * * *` actually calls. Ledger so a
  // silent miss shows up as zero agentsam_cron_runs rows.
  ctx.waitUntil(
    cronLedgerWrap(env, 'code_index_runner', CRON_ONE_AM, async () => {
      const { reclaimStaleFullIndexQueueJobs, runCodeIndexCronStep } = await import(
        './code-index-runner.js'
      );
      const reclaimed = await reclaimStaleFullIndexQueueJobs(env);
      const pumped = await runCodeIndexCronStep(env);
      return {
        ok: reclaimed?.ok !== false && pumped?.ok !== false,
        rowsRead: Number(reclaimed?.rowsRead || 0) + Number(pumped?.rowsRead || 0),
        rowsWritten: Number(reclaimed?.rowsWritten || 0) + Number(pumped?.rowsWritten || 0),
        metadata: { reclaimed, pumped },
      };
    }),
  );
}

/**
 * Five-minute slot — approval notify, iMessage apply, chat orphan sweep,
 * countdown expiry, index reclaim. Log only when a job actually wrote/notified/swept.
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
async function runFiveMinuteSlot(env, ctx) {
  const [notify, swept, timers, reclaim] = await Promise.all([
    runApprovalNotifyCron(env, ctx).catch((e) => {
      console.warn('[cron] approval_notify_sweep', e?.message ?? e);
      return null;
    }),
    import('./agent-run-sweeps.js')
      .then(({ sweepStaleChatAgentRuns }) => sweepStaleChatAgentRuns(env))
      .catch((e) => {
        console.warn('[cron] sweepStaleChatAgentRuns', e?.message ?? e);
        return 0;
      }),
    import('../../src/core/active-timers.js')
      .then(({ expireDueCountdowns }) => expireDueCountdowns(env, { limit: 50 }))
      .catch((e) => {
        console.warn('[cron] expireDueCountdowns', e?.message ?? e);
        return null;
      }),
    import('./code-index-runner.js')
      .then(({ reclaimStaleFullIndexQueueJobs }) => reclaimStaleFullIndexQueueJobs(env))
      .catch((e) => {
        console.warn('[cron] code_index_stale_reclaim', e?.message ?? e);
        return null;
      }),
  ]);

  const work = {
    notified_users: Number(notify?.metadata?.notified_users || 0),
    halted_users: Number(notify?.metadata?.halted_users || 0),
    imessage_enqueued: Number(notify?.metadata?.imessage_enqueued || 0),
    imessage_applied: Number(notify?.metadata?.imessage_applied || 0),
    swept_chat: Number(swept || 0),
    expired: Number(timers?.expired || 0),
    cancelled_spawn_jobs: Number(timers?.cancelled_spawn_jobs || 0),
    reclaimed: Number(reclaim?.reclaimed || 0),
    failed_wasm: Number(reclaim?.failed_wasm || 0),
  };
  if (Object.values(work).some((n) => n > 0)) {
    console.log('[Cron] five_minute_slot', JSON.stringify(work));
  }
}

/**
 * @param {ScheduledEvent} event
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function handleScheduled(event, env, ctx) {
  const cron = event.cron;
  if (!QUIET_CRON_START.has(cron)) {
    console.log('[Cron] Execution starting:', cron);
  }

  switch (cron) {
    // Own five-minute trigger (do NOT share the 20-minute slot — that would also fire meshy/WAE/Veo every 5 min).
    case CRON_FIVE_MINUTE:
      ctx.waitUntil(runFiveMinuteSlot(env, ctx));
      break;

    case CRON_MESHY_CAD_SAFETY:
      ctx.waitUntil(
        runMeshyCadReconcileJobs(env, ctx).catch((e) =>
          console.warn('[cron] meshy_cad_reconcile', e?.message ?? e),
        ),
      );
      // WAE error spike check shares the */20 slot — independent waitUntil
      ctx.waitUntil(
        runWaeErrorSpikeCheck(env, ctx).catch((e) =>
          console.warn('[cron] wae_error_spike_check', e?.message ?? e),
        ),
      );
      // Veo LRO finalize — also on */20 so chat/status is not stuck on 30m only
      ctx.waitUntil(
        import('../../src/core/moviemode-veo-poll.js')
          .then(({ pollPendingVeoJobs }) => pollPendingVeoJobs(env, { limit: 10 }))
          .catch((e) => console.warn('[cron] moviemode_veo_poll_20m', e?.message ?? e)),
      );
      break;

    case '*/25 * * * *':
      ctx.waitUntil(
        runContainerPrewarmCron(env, ctx).catch((e) =>
          console.warn('[cron] container_prewarm', e?.message ?? e),
        ),
      );
      break;

    case '*/30 * * * *':
      await runThirtyMinuteJobs(env, ctx);
      break;

    case '0 * * * *':
      await runHourlyRoutingJobs(env, ctx);
      break;

    case '0 0 * * *':
      await runMidnightUtcJobs(env, ctx);
      if (env?.DB) {
        ctx.waitUntil(writeDailySnapshot(env, 'cron_0010').catch(() => {}));
        if (new Date().getUTCDay() === 0) {
          ctx.waitUntil(runWeeklyRollup(env));
          ctx.waitUntil(
            runWebhookWeeklyRollupCron(env).catch((e) =>
              console.warn('[cron] webhook_weekly_rollup', e?.message ?? e),
            ),
          );
          ctx.waitUntil(
            runCodebaseIndexWeeklyHealthCron(env).catch((e) =>
              console.warn('[cron] codebase_index_weekly_health', e?.message ?? e),
            ),
          );
        }
      }
      break;

    case '0 1 * * *':
      scheduleOneAmMaintenance(env, ctx);
      break;

    case '0 9 * * *':
      ctx.waitUntil(runFinancialCommandCron(env, ctx));
      break;

    case CRON_DAILY_EVOLUTION:
      ctx.waitUntil(
        runDailyEvolutionCuratorCron(env, ctx).catch((e) =>
          console.warn('[cron] daily_evolution_curator', e?.message ?? e),
        ),
      );
      break;

    case '0 9 * * 1':
      ctx.waitUntil(
        runIntegritySnapshot(env, 'cron').catch((e) =>
          console.warn('[cron] runIntegritySnapshot', e?.message ?? e),
        ),
      );
      break;

    case '30 13 * * *':
      ctx.waitUntil(sendDailyPlanEmail(env, ctx));
      break;

    case '0 0 1 * *':
      ctx.waitUntil(runFirstOfMonthJobs(env));
      break;

    default:
      console.warn('[cron] unhandled_cron_expression', cron);
  }
}
