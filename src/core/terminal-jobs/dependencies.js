import { isTerminalJobTerminal } from './state.js';

function jobExists(session, jobId) {
  return !![...session.sql.exec(`SELECT id FROM terminal_jobs WHERE id = ? LIMIT 1`, String(jobId))][0];
}

function dependencyWouldCycle(session, jobId, dependsOnJobId) {
  const row = [...session.sql.exec(`
    WITH RECURSIVE ancestry(id) AS (
      SELECT depends_on_job_id FROM terminal_job_dependencies WHERE job_id = ?
      UNION
      SELECT d.depends_on_job_id
      FROM terminal_job_dependencies d
      JOIN ancestry a ON d.job_id = a.id
    )
    SELECT 1 AS found FROM ancestry WHERE id = ? LIMIT 1
  `, String(dependsOnJobId), String(jobId))][0];
  return !!row;
}

export function setTerminalJobDependencies(session, jobId, ids = []) {
  const id = String(jobId || '').trim();
  const deps = [...new Set((ids || []).map(String).map((x) => x.trim()).filter(Boolean))];
  for (const dep of deps) {
    if (dep === id) throw new Error('terminal_job_dependency_self');
    if (!jobExists(session, dep)) throw new Error(`terminal_job_dependency_not_found:${dep}`);
    if (dependencyWouldCycle(session, id, dep)) throw new Error(`terminal_job_dependency_cycle:${dep}`);
    session.sql.exec(
      `INSERT OR IGNORE INTO terminal_job_dependencies (job_id, depends_on_job_id) VALUES (?, ?)`,
      id,
      dep,
    );
  }
}

export function getTerminalJobDependencies(session, jobId) {
  return [...session.sql.exec(
    `SELECT depends_on_job_id FROM terminal_job_dependencies WHERE job_id = ? ORDER BY depends_on_job_id`,
    String(jobId),
  )].map((r) => String(r.depends_on_job_id));
}

export function terminalJobDependencyState(session, jobId) {
  const ids = getTerminalJobDependencies(session, jobId);
  if (!ids.length) return { state: 'ready', dependencies: [] };
  const dependencies = ids.map((id) => {
    const row = [...session.sql.exec(`SELECT id, status FROM terminal_jobs WHERE id = ? LIMIT 1`, id)][0];
    return row ? { job_id: String(row.id), status: String(row.status) } : { job_id: id, status: 'missing' };
  });
  const failed = dependencies.find((dep) => dep.status === 'missing' || (isTerminalJobTerminal(dep.status) && dep.status !== 'succeeded'));
  if (failed) return { state: 'failed', dependency: failed, dependencies };
  if (dependencies.every((dep) => dep.status === 'succeeded')) return { state: 'ready', dependencies };
  return { state: 'blocked', dependencies };
}

export function terminalJobDependenciesSatisfied(session, jobId) {
  return terminalJobDependencyState(session, jobId).state === 'ready';
}

export function dependentTerminalJobIds(session, jobId) {
  return [...session.sql.exec(
    `SELECT job_id FROM terminal_job_dependencies WHERE depends_on_job_id = ?`,
    String(jobId),
  )].map((r) => String(r.job_id));
}
