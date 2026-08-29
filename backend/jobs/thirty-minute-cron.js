/** Every 30 minutes (worker.js parity). */

import {
  reconcileRoutingArmsFromAgentRuns,
  rollupAgentsamModelRoutingMemory,
  enforceEvalSlosPauseArms,
  enforceTaskSlosFromRoutingMemory,
} from '../agentsam/runtime/routing/routing-cron.js';
import { runApplyEtoToRoutingArmsCron } from '../http/agentsam/routes/ops-runtime.js';
import { scanErrorLogThresholds } from '../telemetry/error-log-escalation.js';
import { runMcpServerHealthCron } from './mcp-server-health.js';
import { runAgentsamMemoryVectorSync } from '../http/agentsam/routes/vector-sync-runtime.js';
import {
  sweepStaleChatAgentRuns,
  sweepStaleNonChatAgentRuns,
} from './agent-run-sweeps.js';
import {
  processQueues,
  sweepExpiredApprovalQueue,
  sweepStaleTerminalSessions,
} from './cron-maintenance.js';

/** @deprecated Use reconcileRoutingArmsFromAgentRuns (agentsam_agent_run, not routing_decisions). */
export async function updateRoutingPerformanceScores(env) {
  await reconcileRoutingArmsFromAgentRuns(env);
}

export async function runThirtyMinuteJobs(env, ctx) {
  // Stuck sweep runs at midnight UTC — was 48×/day with 0 writes when on 30-min cron.
  ctx.waitUntil(sweepExpiredApprovalQueue(env));
  ctx.waitUntil(sweepStaleTerminalSessions(env));
  // Chat orphans: also on the five-minute cron — keep here if that slot misses.
  ctx.waitUntil(sweepStaleChatAgentRuns(env));
  ctx.waitUntil(sweepStaleNonChatAgentRuns(env));
  ctx.waitUntil(
    import('../../src/core/error-log-reconcile.js')
      .then(({ reconcileErrorLogResolutions }) => reconcileErrorLogResolutions(env))
      .catch((e) => console.warn('[cron] reconcileErrorLogResolutions', e?.message ?? e)),
  );
  ctx.waitUntil(
    import('../../src/core/keys-security.js')
      .then(({ runSecurityShieldPulseCron }) => runSecurityShieldPulseCron(env))
      .catch((e) => console.warn('[cron] security_shield_pulse', e?.message ?? e)),
  );
  ctx.waitUntil(runMcpServerHealthCron(env).catch((e) => console.warn('[cron] mcp_server_health', e?.message ?? e)));
  ctx.waitUntil(
    import('./google-calendar-sync-cron.js')
      .then(({ runGoogleCalendarSyncJob }) => runGoogleCalendarSyncJob(env))
      .catch((e) => console.warn('[cron] google_calendar_sync', e?.message ?? e)),
  );
  ctx.waitUntil(
    import('../../src/core/oauth-token-liveness.js')
      .then(({ sweepOAuthTokenLiveness }) =>
        sweepOAuthTokenLiveness(env).then((r) => {
          if (r.deactivated || r.normalized || r.refreshed || r.refreshFailed) {
            console.log('[cron] oauth_token_liveness', JSON.stringify(r));
          }
        }),
      )
      .catch((e) => console.warn('[cron] oauth_token_liveness', e?.message ?? e)),
  );
  ctx.waitUntil(
    import('../../src/core/moviemode-veo-poll.js')
      .then(({ pollPendingVeoJobs }) => pollPendingVeoJobs(env))
      .catch((e) => console.warn('[cron] moviemode_veo_poll', e?.message ?? e)),
  );
  ctx.waitUntil(
    import('./pg-stat-statements-snapshot.js')
      .then(({ runPgStatStatementsSnapshotCron }) => runPgStatStatementsSnapshotCron(env))
      .catch((e) => console.warn('[cron] pg_stat_statements_snapshot', e?.message ?? e)),
  );
  ctx.waitUntil(
    import('../agentsam/runtime/routing/model-health.js')
      .then(({ runModelHealthRollupCron }) => runModelHealthRollupCron(env))
      .catch((e) => console.warn('[cron] model_health_rollup', e?.message ?? e)),
  );
}

export async function runHourlyRoutingJobs(env, ctx) {
  // Apply must be awaited + ledgered. Sibling hourly jobs (reconcile / memory
  // rollup) completing green is not proof ETO applied — those jobs never call it.
  await runApplyEtoToRoutingArmsCron(env);
  ctx.waitUntil(reconcileRoutingArmsFromAgentRuns(env).catch(e => console.warn('[cron/hourly] reconcileRoutingArms', e?.message)));
  ctx.waitUntil(rollupAgentsamModelRoutingMemory(env).catch(e => console.warn('[cron/hourly] rollupRoutingMemory', e?.message)));
  ctx.waitUntil(enforceTaskSlosFromRoutingMemory(env).catch(e => console.warn('[cron/hourly] enforceSlos', e?.message)));
  ctx.waitUntil(enforceEvalSlosPauseArms(env, { lookbackDays: 7 }).catch(e => console.warn('[cron/hourly] enforceEvalSlos', e?.message)));
  // routing_analytics_rollups disabled — duplicated execution_performance rollup with 0 writes.
  ctx.waitUntil(processQueues(env).catch((e) => console.warn('[cron/hourly] agentsam_request_queue_drain', e?.message)));
  ctx.waitUntil(scanErrorLogThresholds(env).catch(e => console.warn('[cron/hourly] errorLogThresholds', e?.message)));
  ctx.waitUntil(
    runAgentsamMemoryVectorSync(env, { cronExpression: '0 * * * *' }).catch((e) =>
      console.warn('[cron/hourly] agentsam_memory_oai3large_1536_sync', e?.message ?? e),
    ),
  );
  ctx.waitUntil(
    import('../../src/core/agentsam-memory-outbox.js')
      .then(({ drainMemoryProjectionOutbox }) => drainMemoryProjectionOutbox(env, { limit: 40 }))
      .catch((e) => console.warn('[cron/hourly] memory_projection_outbox', e?.message ?? e)),
  );
  ctx.waitUntil(
    import('../../src/core/knowledge/projection-outbox-drain.js')
      .then(({ drainKnowledgeProjectionOutbox }) => drainKnowledgeProjectionOutbox(env, { limit: 40 }))
      .catch((e) => console.warn('[cron/hourly] knowledge_projection_outbox', e?.message ?? e)),
  );
  ctx.waitUntil(
    import('../../src/core/agentsam-vector-sync-outbox.js')
      .then(({ drainVectorSyncOutbox }) => drainVectorSyncOutbox(env, { limit: 40 }))
      .catch((e) => console.warn('[cron/hourly] vector_sync_outbox', e?.message ?? e)),
  );
  ctx.waitUntil(
    import('../../src/core/auth.js')
      .then(({ pruneExpiredAuthSessions }) => pruneExpiredAuthSessions(env, { limit: 200 }))
      .catch((e) => console.warn('[cron/hourly] prune_expired_auth_sessions', e?.message ?? e)),
  );
}
