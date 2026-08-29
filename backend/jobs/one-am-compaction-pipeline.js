/**
 * Unified 1 AM compaction pipeline — ordered rollups and purges (six-table addendum).
 *
 * 1. rollupExecutionPerformanceMetrics (includes Batch 2 tool_chain → EPM/usage feed)
 * 2. runEtoPipeline
 * 3. rollupUsageEventsDaily
 * 4. rollupToolCallLogDaily
 * 5. archiveAgentRunsDailyToR2 + pruneCompletedAgentRuns
 * 6. purgeExpiredToolCache
 * 7. purgeErrorLog
 * 8. purgeHookExecution
 * 9. purgeUsageEventsAfterRollup
 * 10. (prune included in step 5)
 * 11. retention_purge (tool_call_log / usage_events / hook_execution skipped)
 */

import { rollupExecutionPerformanceMetrics } from '../../src/core/memory.js';
import { runEtoPipeline } from '../http/agentsam/routes/ops-runtime.js';
import { runExecutionJournalLearningFeed } from '../../src/core/execution-journal-learning-feed.js';
import { rollupUsageEventsDaily, purgeUsageEventsAfterRollup } from '../../src/core/usage-events-rollup.js';
import {
  rollupToolCallLogDaily,
  purgeExpiredToolCache,
  purgeErrorLog,
  purgeHookExecution,
} from '../../src/core/one-am-table-compaction.js';
import {
  archiveAgentRunsDailyToR2,
  pruneCompletedAgentRuns,
} from './agent-run-daily-rollup.js';
import { runRetentionPurge } from './retention-purge.js';
import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';

const CRON_ONE_AM = '0 1 * * *';

/**
 * @param {any} env
 */
export async function runOneAmCompactionPipeline(env) {
  const steps = {};

  steps.epm = await rollupExecutionPerformanceMetrics(env)
    .then(() => ({ ok: true }))
    .catch((e) => {
      console.warn('[1am-pipeline] epm', e?.message ?? e);
      return { ok: false, error: String(e?.message || e) };
    });

  // Explicit Batch 2 feed for today when midnight EPM rollup targets yesterday only.
  // Safe re-run: EPM ON CONFLICT upsert; usage uses MAX. Fail-loud on missing summaries.
  steps.journal_learning_feed = await runExecutionJournalLearningFeed(env, {
    metricDate: new Date().toISOString().slice(0, 10),
  })
    .then((r) => ({ ok: true, ...(r && typeof r === 'object' ? r : {}) }))
    .catch((e) => {
      console.error('[1am-pipeline] journal_learning_feed', e?.message ?? e);
      return {
        ok: false,
        error: String(e?.message || e),
        ...(e?.feedResult && typeof e.feedResult === 'object' ? { partial: e.feedResult } : {}),
      };
    });

  steps.eto = await runEtoPipeline(env)
    .then((r) => ({ ok: true, ...(r && typeof r === 'object' ? r : {}) }))
    .catch((e) => {
      console.warn('[1am-pipeline] eto', e?.message ?? e);
      return { ok: false, error: String(e?.message || e) };
    });

  steps.usage_events_rollup = await rollupUsageEventsDaily(env);
  steps.tool_call_log = await rollupToolCallLogDaily(env);

  steps.agent_run_archive = await archiveAgentRunsDailyToR2(env);
  steps.agent_run_prune = await pruneCompletedAgentRuns(env);

  steps.tool_cache = await purgeExpiredToolCache(env);
  steps.error_log = await purgeErrorLog(env);
  steps.hook_execution = await purgeHookExecution(env);
  steps.usage_events_purge = await purgeUsageEventsAfterRollup(env);

  steps.retention_purge = await runRetentionPurge(env).catch((e) => {
    console.warn('[1am-pipeline] retention_purge', e?.message ?? e);
    return { ok: false, error: String(e?.message || e) };
  });

  const rowsWritten =
    (steps.usage_events_purge?.deleted ?? 0) +
    (steps.tool_call_log?.deleted ?? 0) +
    (steps.tool_cache?.deleted ?? 0) +
    (steps.error_log?.deleted ?? 0) +
    (steps.hook_execution?.deleted ?? 0) +
    (steps.agent_run_prune?.deleted ?? 0) +
    (steps.retention_purge?.rowsWritten ?? 0) +
    (steps.journal_learning_feed?.epm?.changes ?? 0) +
    (steps.journal_learning_feed?.usage?.changes ?? 0) +
    (steps.journal_learning_feed?.partial?.epm?.changes ?? 0) +
    (steps.journal_learning_feed?.partial?.usage?.changes ?? 0);

  if (steps.journal_learning_feed?.ok === false) {
    const err = new Error(
      steps.journal_learning_feed.error || 'journal_learning_feed_failed',
    );
    err.pipelineSteps = steps;
    throw err;
  }

  return { ok: true, steps, rowsWritten };
}

/**
 * Ledger-wrapped entry for scheduled cron.
 * @param {any} env
 */
export async function runOneAmCompactionPipelineLedgered(env) {
  const begun = await startCronRun(env, {
    jobName: 'one_am_compaction_pipeline',
    cronExpression: CRON_ONE_AM,
    tenantId: null,
    workspaceId: null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();

  try {
    const out = await runOneAmCompactionPipeline(env);
    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead: 0,
        rowsWritten: out.rowsWritten ?? 0,
        metadata: { steps: out.steps },
      });
    }
    return out;
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    throw e;
  }
}
