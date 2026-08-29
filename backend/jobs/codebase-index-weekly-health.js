import { completeCronRun, failCronRun, startCronRun } from './cron-run-ledger.js';
import {
  listCodeIndexHealthTargets,
  runCodebaseIndexWeeklyHealth,
} from '../agentsam/codebase/codebase-index-health.js';

/**
 * Sunday weekly job — surface pgvector codebase files stale vs GitHub.
 * Iterates completed index jobs' repo_full_name — never a platform DEFAULT_REPO.
 * @param {any} env
 */
export async function runCodebaseIndexWeeklyHealthCron(env) {
  const begun = await startCronRun(env, {
    jobName: 'codebase_index_weekly_health',
    cronExpression: '0 0 * * 0',
    tenantId: null,
    workspaceId: env?.WORKSPACE_ID ? String(env.WORKSPACE_ID) : null,
  });
  const runId = begun?.runId ?? null;
  const startedAt = begun?.startedAt ?? Date.now();
  try {
    const targets = await listCodeIndexHealthTargets(env);
    if (!targets.length) {
      const skipped = {
        ok: false,
        skipped: true,
        reason: 'no_indexed_repos',
        total_indexed: 0,
        stale_index_count: 0,
        rowsWritten: 0,
      };
      if (runId) {
        await completeCronRun(env, runId, startedAt, {
          rowsRead: 0,
          rowsWritten: 0,
          metadata: { skipped: true, reason: skipped.reason, targets: 0 },
        });
      }
      return skipped;
    }

    let rowsRead = 0;
    let rowsWritten = 0;
    let staleTotal = 0;
    /** @type {Array<Record<string, unknown>>} */
    const results = [];

    for (const t of targets) {
      const out = await runCodebaseIndexWeeklyHealth(env, {
        workspaceUuid: t.workspaceUuid,
        workspaceKey: t.workspaceKey,
        repo: t.repo,
      });
      results.push({
        repo: t.repo,
        workspace_key: t.workspaceKey,
        ok: out.ok === true,
        skipped: out.skipped === true,
        reason: out.reason ?? null,
        stale_index_count: out.stale_index_count ?? 0,
      });
      rowsRead += Number(out.total_indexed) || 0;
      rowsWritten += Number(out.rowsWritten) || 0;
      staleTotal += Number(out.stale_index_count) || 0;
      if (out.stale_index_count > 0) {
        console.warn(
          '[codebase_index_weekly_health] stale=%s repo=%s workspace=%s',
          out.stale_index_count,
          t.repo,
          t.workspaceKey,
        );
      }
    }

    if (runId) {
      await completeCronRun(env, runId, startedAt, {
        rowsRead,
        rowsWritten,
        metadata: {
          stale_index_count: staleTotal,
          targets: targets.length,
          results,
        },
      });
    }

    return {
      ok: true,
      targets: targets.length,
      stale_index_count: staleTotal,
      total_indexed: rowsRead,
      rowsWritten,
      results,
    };
  } catch (e) {
    if (runId) await failCronRun(env, runId, startedAt, e);
    throw e;
  }
}
