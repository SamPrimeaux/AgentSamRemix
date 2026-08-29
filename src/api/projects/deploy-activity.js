/**
 * Projects API — peeled from monolithic projects.js (mechanical).
 */
import { jsonResponse } from '../../core/auth.js';
import { assertWorkspaceAllowed } from './helpers.js';

export async function handleDeployActivity(env, authUser, url, workspaceId) {
  const tenantId = authUser?.tenant_id ? String(authUser.tenant_id) : null;

  const daysParam = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10)));
  const workerFilter = url.searchParams.get('worker') || null;

  if (!env.DB) return jsonResponse({ ok: false, error: 'db_unavailable' }, 503);

  try {
    const cutoffUnix = Math.floor(Date.now() / 1000) - daysParam * 86400;

    const { results } = await env.DB.prepare(`
      SELECT metadata_json, received_at_unix
      FROM agentsam_webhook_events
      WHERE event_type = 'cf.workersBuilds.worker.build.succeeded'
        AND (tenant_id = ? OR workspace_id = ?)
        AND received_at_unix >= ?
      ORDER BY received_at_unix ASC
    `).bind(
      tenantId || '',
      workspaceId || '',
      cutoffUnix,
    ).all();

    /** @type {Map<string, { start: number, end: number, commits: string[], count: number, worker: string, date: string }>} */
    const byDayWorker = new Map();

    for (const row of results || []) {
      let meta;
      try { meta = JSON.parse(String(row.metadata_json || '{}')); } catch { continue; }

      const workerName = meta.worker_name || null;
      if (!workerName) continue;
      if (workerFilter && workerName !== workerFilter) continue;

      const createdAt = Number(meta.created_at_unix) || null;
      const stoppedAt = Number(meta.stopped_at_unix) || Number(row.received_at_unix) || null;
      if (!createdAt || !stoppedAt) continue;

      const date = new Date(createdAt * 1000).toISOString().slice(0, 10);
      const commitMsg = meta.commit_message || null;
      const key = `${date}::${workerName}`;

      if (!byDayWorker.has(key)) {
        byDayWorker.set(key, { start: createdAt, end: stoppedAt, commits: [], count: 0, worker: workerName, date });
      }
      const entry = byDayWorker.get(key);
      if (createdAt < entry.start) entry.start = createdAt;
      if (stoppedAt > entry.end) entry.end = stoppedAt;
      entry.count += 1;
      if (commitMsg && !entry.commits.includes(commitMsg)) entry.commits.push(commitMsg);
    }

    const days = [...byDayWorker.values()]
      .map((e) => ({
        date: e.date,
        worker: e.worker,
        session_start: new Date(e.start * 1000).toISOString(),
        session_end: new Date(e.end * 1000).toISOString(),
        session_minutes: Math.max(1, Math.round((e.end - e.start) / 60)),
        build_count: e.count,
        commits: e.commits.slice(0, 20),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    // Roll up per-worker totals
    /** @type {Record<string, { total_minutes: number, active_days: number, last_active: string }>} */
    const byWorker = {};
    for (const d of days) {
      if (!byWorker[d.worker]) byWorker[d.worker] = { total_minutes: 0, active_days: 0, last_active: '' };
      byWorker[d.worker].total_minutes += d.session_minutes;
      byWorker[d.worker].active_days += 1;
      if (!byWorker[d.worker].last_active || d.date > byWorker[d.worker].last_active) {
        byWorker[d.worker].last_active = d.date;
      }
    }

    return projectsJsonResponse({ ok: true, days, by_worker: byWorker, lookback_days: daysParam }, 200, 'private, max-age=60');
  } catch (e) {
    return jsonResponse({ ok: false, error: String(e?.message || e) }, 500);
  }
}
