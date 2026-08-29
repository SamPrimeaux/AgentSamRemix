import { getTerminalJob, updateTerminalJob } from './store.js';
import { getTerminalJobDependencies, dependentTerminalJobIds } from './dependencies.js';
import { publishTerminalJobEvent } from './events.js';
import { emitTerminalJobResume } from './resumptions.js';

export async function finalizeTerminalJobOrchestration(session, job) {
  if (!job) return;
  await emitTerminalJobResume(session, job).catch(() => {});
  for (const id of dependentTerminalJobIds(session, job.job_id)) {
    const child = getTerminalJob(session, id);
    if (!child || child.status !== 'queued') continue;
    const deps = getTerminalJobDependencies(session, id).map((depId) => getTerminalJob(session, depId));
    if (deps.some((dep) => !dep || !['succeeded','failed','cancelled','timed_out'].includes(dep.status))) continue;
    const failedDep = deps.find((dep) => dep.status !== 'succeeded');
    if (failedDep) {
      const failed = updateTerminalJob(session, id, { status: 'failed', progress: 100, error: `dependency_failed:${failedDep.job_id}`, finished_at: Math.floor(Date.now()/1000) });
      publishTerminalJobEvent(session, id, 'failed', failed);
      await finalizeTerminalJobOrchestration(session, failed);
      continue;
    }
    const { runTerminalJob } = await import('./runner.js');
    session.ctx.waitUntil(runTerminalJob(session, id, {}));
  }
}
export async function reconcileTerminalJobOrchestration(session) {
  const terminalRows = [...session.sql.exec(`
    SELECT id FROM terminal_jobs j
    WHERE j.status IN ('succeeded','failed','cancelled','timed_out')
      AND (
        (j.resume_policy != 'none' AND j.resumed_at IS NULL)
        OR EXISTS (
          SELECT 1 FROM terminal_job_dependencies d
          WHERE d.depends_on_job_id = j.id
        )
      )
    ORDER BY j.updated_at ASC
    LIMIT 500
  `)];
  for (const row of terminalRows) {
    const job = getTerminalJob(session, String(row.id));
    if (job) await finalizeTerminalJobOrchestration(session, job);
  }

  const queuedRows = [...session.sql.exec(`
    SELECT id FROM terminal_jobs
    WHERE status = 'queued'
    ORDER BY created_at ASC
    LIMIT 500
  `)];
  for (const row of queuedRows) {
    const job = getTerminalJob(session, String(row.id));
    if (!job || job.status !== 'queued') continue;
    const deps = getTerminalJobDependencies(session, job.job_id).map((depId) => getTerminalJob(session, depId));
    if (deps.some((dep) => !dep || !['succeeded','failed','cancelled','timed_out'].includes(dep.status))) continue;
    const failedDep = deps.find((dep) => dep.status !== 'succeeded');
    if (failedDep) {
      const failed = updateTerminalJob(session, job.job_id, {
        status: 'failed', progress: 100,
        error: `dependency_failed:${failedDep.job_id}`,
        finished_at: Math.floor(Date.now() / 1000),
      });
      publishTerminalJobEvent(session, job.job_id, 'failed', failed);
      await finalizeTerminalJobOrchestration(session, failed);
      continue;
    }
    const { runTerminalJob } = await import('./runner.js');
    session.ctx.waitUntil(runTerminalJob(session, job.job_id, {}));
  }
  return terminalRows.length + queuedRows.length;
}
