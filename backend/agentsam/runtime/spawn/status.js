/**
 * Spawn-job status and merged-output persistence.
 *
 * This module records orchestration state without choosing the graph or lane
 * roles. The orchestrator remains free to use any execution shape.
 */

function trim(value) {
  return value == null ? '' : String(value).trim();
}

export async function getSpawnJobRow(env, spawnJobId) {
  if (!env?.DB || !trim(spawnJobId)) return null;
  return env.DB.prepare(
    `SELECT * FROM agentsam_spawn_job WHERE id = ? LIMIT 1`,
  )
    .bind(trim(spawnJobId))
    .first()
    .catch(() => null);
}

export async function setSpawnJobMergedOutput(env, spawnJobId, state) {
  if (!env?.DB || !trim(spawnJobId)) return { ok: false, reason: 'no_db' };
  const mergedOutput = JSON.stringify(state ?? {}).slice(0, 120000);
  const score = Number(state?.best_score);
  try {
    await env.DB.prepare(
      `UPDATE agentsam_spawn_job
          SET merged_output = ?, merge_quality_score = ?
        WHERE id = ?`,
    )
      .bind(mergedOutput, Number.isFinite(score) ? score : null, trim(spawnJobId))
      .run();
    return { ok: true, reason: null };
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) };
  }
}

export async function setSpawnJobStatus(env, spawnJobId, status) {
  if (!env?.DB || !trim(spawnJobId)) return { ok: false, reason: 'no_db' };
  try {
    await env.DB.prepare(`UPDATE agentsam_spawn_job SET status = ? WHERE id = ?`)
      .bind(trim(status), trim(spawnJobId))
      .run();
    return { ok: true, reason: null };
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) };
  }
}

export function parseSkillMergedOutput(raw, defaults = {}) {
  if (raw == null || raw === '') return { ...defaults };
  if (typeof raw === 'object') return { ...defaults, ...raw };
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? { ...defaults, ...parsed } : { ...defaults };
  } catch {
    return { ...defaults };
  }
}
