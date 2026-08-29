// guard-dup-allow: backend spawn peel; shared timer callers migrate separately.
/**
 * Countdown timers owned by multitask spawn jobs.
 */

function trim(value) {
  return value == null ? '' : String(value).trim();
}

async function assertSubjectExists(env, subjectType, subjectId) {
  const table = subjectType === 'spawn_job'
    ? 'agentsam_spawn_job'
    : subjectType === 'agent_run'
      ? 'agentsam_agent_run'
      : null;
  if (!table) throw new Error(`subject_type_invalid:${subjectType}`);
  const row = await env.DB.prepare(`SELECT id FROM ${table} WHERE id = ? LIMIT 1`)
    .bind(subjectId).first();
  if (!row?.id) throw new Error(`subject_missing:${subjectType}:${subjectId}`);
}

export async function startActiveTimer(env, p = {}) {
  if (!env?.DB) throw new Error('Database not configured');
  const tenantId = trim(p.tenant_id);
  const subjectType = trim(p.subject_type);
  const subjectId = trim(p.subject_id);
  if (!tenantId || !subjectId) throw new Error('timer_scope_required');
  await assertSubjectExists(env, subjectType, subjectId);
  const now = Math.floor(Date.now() / 1000);
  const duration = Number(p.duration_seconds);
  const endsAt = Number.isFinite(duration) && duration > 0
    ? now + Math.floor(duration)
    : Number.isFinite(Number(p.ends_at_unix)) ? Math.floor(Number(p.ends_at_unix)) : null;
  if (!endsAt || endsAt <= now) throw new Error('countdown_ends_at_required');
  const id = `tmr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await env.DB.prepare(
    `INSERT INTO active_timers (
       id, tenant_id, workspace_id, user_id, person_uuid, subject_type, subject_id,
       mode, label, timer_kind, status, started_at_unix, ends_at_unix, elapsed_seconds,
       conversation_id, agent_run_id, spawn_job_id, spawn_session_id, metadata_json,
       updated_at_unix
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'countdown', 'running', ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    tenantId,
    trim(p.workspace_id),
    trim(p.user_id) || null,
    trim(p.person_uuid) || null,
    subjectType,
    subjectId,
    trim(p.mode) || null,
    trim(p.label).slice(0, 200),
    now,
    endsAt,
    trim(p.conversation_id) || null,
    trim(p.agent_run_id) || null,
    trim(p.spawn_job_id) || null,
    trim(p.spawn_session_id) || null,
    JSON.stringify(p.metadata || {}).slice(0, 4000),
    now,
  ).run();
  return { ok: true, id, started_at_unix: now, ends_at_unix: endsAt };
}

export async function stopActiveTimer(env, timerId, status = 'completed') {
  const id = trim(timerId);
  if (!env?.DB || !id) throw new Error('timer_id_required');
  const row = await env.DB.prepare(
    `SELECT id, started_at_unix, status FROM active_timers WHERE id = ? LIMIT 1`,
  ).bind(id).first();
  if (!row?.id) throw new Error(`timer_missing:${id}`);
  if (!['running', 'paused'].includes(trim(row.status))) {
    return { ok: true, id, status: row.status, skipped: true };
  }
  const now = Math.floor(Date.now() / 1000);
  const elapsed = Math.max(0, now - (Number(row.started_at_unix) || now));
  await env.DB.prepare(
    `UPDATE active_timers
        SET status = ?, elapsed_seconds = ?, completed_at_unix = ?, updated_at_unix = ?
      WHERE id = ?`,
  ).bind(trim(status) || 'completed', elapsed, now, now, id).run();
  return { ok: true, id, status: trim(status) || 'completed', elapsed_seconds: elapsed };
}

export async function startSpawnJobWallClock(env, p = {}) {
  const id = trim(p.spawn_job_id);
  if (!id) throw new Error('spawn_job_id_required');
  if (!trim(p.conversation_id)) throw new Error('conversation_id_required');
  return startActiveTimer(env, {
    ...p,
    subject_type: 'spawn_job',
    subject_id: id,
    timer_kind: 'countdown',
  });
}

export async function startSpawnChildTimer(env, p = {}) {
  const id = trim(p.agent_run_id);
  if (!id) throw new Error('agent_run_id_required');
  if (!trim(p.conversation_id)) throw new Error('conversation_id_required');
  return startActiveTimer(env, {
    ...p,
    subject_type: 'agent_run',
    subject_id: id,
    timer_kind: 'countdown',
  });
}

export async function stopAllTimersForSpawnJob(env, spawnJobId, status = 'completed') {
  const id = trim(spawnJobId);
  if (!env?.DB || !id) throw new Error('spawn_job_id_required');
  const rows = await env.DB.prepare(
    `SELECT id FROM active_timers
      WHERE spawn_job_id = ? AND status IN ('running', 'paused')`,
  ).bind(id).all();
  let stopped = 0;
  for (const row of rows.results || []) {
    await stopActiveTimer(env, row.id, status);
    stopped += 1;
  }
  return { ok: true, stopped };
}
