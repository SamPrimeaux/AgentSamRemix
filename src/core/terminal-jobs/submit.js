import { createTerminalJob, updateTerminalJob } from './store.js';
import { publishTerminalJobEvent } from './events.js';
import { terminalJobDependencyState } from './dependencies.js';
import { runTerminalJob } from './runner.js';

export function submitTerminalJob(session, body = {}) {
  const job = createTerminalJob(session, body);
  if (job.deduped) return job;
  publishTerminalJobEvent(session, job.job_id, 'queued', job);
  const depState = terminalJobDependencyState(session, job.job_id);
  if (depState.state === 'failed') {
    const failed = updateTerminalJob(session, job.job_id, {
      status: 'failed',
      progress: 100,
      error: `dependency_failed:${depState.dependency.job_id}`,
      finished_at: Math.floor(Date.now() / 1000),
    });
    publishTerminalJobEvent(session, job.job_id, 'failed', failed);
    session.ctx.waitUntil(
      import('./orchestration.js').then(({ finalizeTerminalJobOrchestration }) =>
        finalizeTerminalJobOrchestration(session, failed),
      ),
    );
    return failed;
  }
  if (depState.state === 'blocked') {
    publishTerminalJobEvent(session, job.job_id, 'blocked', {
      job_id: job.job_id,
      dependencies: depState.dependencies,
    });
    return job;
  }
  session.ctx.waitUntil(runTerminalJob(session, job.job_id, body));
  return job;
}
