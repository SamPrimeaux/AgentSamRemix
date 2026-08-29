/**
 * active_timers — multi-subject stopwatch / countdown (migration 1123).
 * Durable close → time_entries via caller when billable.
 */

const SUBJECT_TABLE = Object.freeze({
  agent_run: 'agentsam_agent_run',
  spawn_job: 'agentsam_spawn_job',
  spawn_session: 'agentsam_spawn_session',
  escalation: 'agentsam_escalation',
  execution: 'agentsam_executions',
  execution_step: 'agentsam_execution_steps',
  command_run: 'agentsam_command_run',
  ticket: 'agentsam_tickets',
  todo: 'agentsam_todo',
  deploy: 'agentsam_agent_run',
  work_session: 'work_sessions',
});

const SUBJECT_PK = Object.freeze({
  work_session: 'session_id',
});

/**
 * @param {unknown} env
 * @param {string} subjectType
 * @param {string} subjectId
 */
async function assertSubjectExists(env, subjectType, subjectId) {
  const table = SUBJECT_TABLE[subjectType];
  if (!table) throw new Error(`subject_type_invalid:${subjectType}`);
  const pk = SUBJECT_PK[subjectType] || 'id';
  const row = await env.DB.prepare(
    `SELECT ${pk} AS sid FROM ${table} WHERE ${pk} = ? LIMIT 1`,
  )
    .bind(subjectId)
    .first();
  if (!row?.sid) throw new Error(`subject_missing:${subjectType}:${subjectId}`);
}

/**
 * @param {unknown} env
 * @param {{
 *   tenant_id: string,
 *   workspace_id?: string|null,
 *   user_id?: string|null,
 *   person_uuid?: string|null,
 *   subject_type: string,
 *   subject_id: string,
 *   mode?: string|null,
 *   label?: string|null,
 *   timer_kind: 'stopwatch'|'countdown',
 *   ends_at_unix?: number|null,
 *   duration_seconds?: number|null,
 *   conversation_id?: string|null,
 *   agent_run_id?: string|null,
 *   spawn_job_id?: string|null,
 *   spawn_session_id?: string|null,
 *   escalation_id?: string|null,
 *   approval_queue_id?: string|null,
 *   metadata?: Record<string, unknown>|null,
 * }} p
 */
export async function startActiveTimer(env, p) {
  if (!env?.DB) throw new Error('Database not configured');

  const tenantId = String(p.tenant_id || '').trim();
  const subjectType = String(p.subject_type || '').trim();
  const subjectId = String(p.subject_id || '').trim();
  const timerKind = String(p.timer_kind || '').trim();
  if (!tenantId) throw new Error('tenant_id_required');
  if (!subjectId) throw new Error('subject_id_required');
  if (timerKind !== 'stopwatch' && timerKind !== 'countdown') {
    throw new Error(`timer_kind_invalid:${timerKind}`);
  }

  await assertSubjectExists(env, subjectType, subjectId);

  const now = Math.floor(Date.now() / 1000);
  let endsAt = null;
  if (timerKind === 'countdown') {
    if (Number.isFinite(Number(p.ends_at_unix))) {
      endsAt = Math.floor(Number(p.ends_at_unix));
    } else if (Number.isFinite(Number(p.duration_seconds)) && Number(p.duration_seconds) > 0) {
      endsAt = now + Math.floor(Number(p.duration_seconds));
    } else {
      throw new Error('countdown_ends_at_required');
    }
    if (endsAt <= now) throw new Error('countdown_ends_at_invalid');
  }

  const id = `tmr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const meta =
    p.metadata && typeof p.metadata === 'object' ? JSON.stringify(p.metadata) : '{}';
  const mode =
    p.mode != null && String(p.mode).trim()
      ? String(p.mode).trim().toLowerCase()
      : null;

  await env.DB.prepare(
    `INSERT INTO active_timers (
       id, tenant_id, workspace_id, user_id, person_uuid,
       subject_type, subject_id, mode, label, timer_kind, status,
       started_at_unix, ends_at_unix, elapsed_seconds,
       conversation_id, agent_run_id, spawn_job_id, spawn_session_id,
       escalation_id, approval_queue_id, metadata_json, updated_at_unix
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      tenantId,
      p.workspace_id != null ? String(p.workspace_id).trim() : '',
      p.user_id != null ? String(p.user_id).trim() || null : null,
      p.person_uuid != null ? String(p.person_uuid).trim() || null : null,
      subjectType,
      subjectId,
      mode,
      p.label != null ? String(p.label).slice(0, 200) : '',
      timerKind,
      now,
      endsAt,
      p.conversation_id != null ? String(p.conversation_id).trim() || null : null,
      p.agent_run_id != null ? String(p.agent_run_id).trim() || null : null,
      p.spawn_job_id != null ? String(p.spawn_job_id).trim() || null : null,
      p.spawn_session_id != null ? String(p.spawn_session_id).trim() || null : null,
      p.escalation_id != null ? String(p.escalation_id).trim() || null : null,
      p.approval_queue_id != null ? String(p.approval_queue_id).trim() || null : null,
      meta.slice(0, 4000),
      now,
    )
    .run();

  return { ok: true, id, started_at_unix: now, ends_at_unix: endsAt };
}

/**
 * @param {unknown} env
 * @param {string} timerId
 * @param {'completed'|'cancelled'|'expired'} [status]
 * @param {{ time_entry_id?: string|null }} [opts]
 */
export async function stopActiveTimer(env, timerId, status = 'completed', opts = {}) {
  if (!env?.DB) throw new Error('Database not configured');
  const id = String(timerId || '').trim();
  if (!id) throw new Error('timer_id_required');
  const st = String(status || 'completed').trim();
  if (!['completed', 'cancelled', 'expired'].includes(st)) {
    throw new Error(`timer_status_invalid:${st}`);
  }

  const row = await env.DB.prepare(
    `SELECT id, started_at_unix, paused_at_unix, elapsed_seconds, status
     FROM active_timers WHERE id = ? LIMIT 1`,
  )
    .bind(id)
    .first();
  if (!row?.id) throw new Error(`timer_missing:${id}`);
  if (row.status !== 'running' && row.status !== 'paused') {
    return { ok: true, id, status: row.status, skipped: true };
  }

  const now = Math.floor(Date.now() / 1000);
  const started = Number(row.started_at_unix);
  let elapsed = Number(row.elapsed_seconds) || 0;
  if (row.status === 'running') {
    if (Number.isFinite(started) && started > 0) {
      elapsed = Math.max(elapsed, Math.max(0, now - started));
    }
  } else if (row.status === 'paused') {
    const pausedAt = Number(row.paused_at_unix);
    if (Number.isFinite(pausedAt) && pausedAt > 0 && Number.isFinite(started) && started > 0) {
      elapsed = Math.max(elapsed, Math.max(0, pausedAt - started));
    }
  }

  await env.DB.prepare(
    `UPDATE active_timers SET
       status = ?,
       elapsed_seconds = ?,
       completed_at_unix = ?,
       time_entry_id = COALESCE(?, time_entry_id),
       updated_at_unix = ?
     WHERE id = ?`,
  )
    .bind(
      st,
      elapsed,
      now,
      opts.time_entry_id != null ? String(opts.time_entry_id).trim() || null : null,
      now,
      id,
    )
    .run();

  return { ok: true, id, status: st, elapsed_seconds: elapsed };
}

/**
 * Stop the single running timer for a subject (no-op if none).
 * @param {unknown} env
 * @param {string} subjectType
 * @param {string} subjectId
 * @param {'completed'|'cancelled'|'expired'} [status]
 */
export async function stopTimerForSubject(env, subjectType, subjectId, status = 'completed') {
  if (!env?.DB) throw new Error('Database not configured');
  const st = String(subjectType || '').trim();
  const sid = String(subjectId || '').trim();
  if (!st || !sid) throw new Error('subject_required');
  const row = await env.DB.prepare(
    `SELECT id FROM active_timers
     WHERE subject_type = ? AND subject_id = ? AND status IN ('running', 'paused')
     LIMIT 1`,
  )
    .bind(st, sid)
    .first();
  if (!row?.id) return { ok: true, skipped: true, reason: 'no_running_timer' };
  return stopActiveTimer(env, row.id, status);
}

/**
 * Wall clock for an entire spawn_job fanout. Fail loud — caller must not proceed without it.
 * Prefers countdown when duration_seconds / ends_at_unix provided (time budget).
 * @param {unknown} env
 * @param {{
 *   tenant_id: string,
 *   workspace_id?: string|null,
 *   user_id?: string|null,
 *   person_uuid?: string|null,
 *   spawn_job_id: string,
 *   mode?: string|null,
 *   conversation_id?: string|null,
 *   agent_run_id?: string|null,
 *   label?: string|null,
 *   duration_seconds?: number|null,
 *   ends_at_unix?: number|null,
 *   metadata?: Record<string, unknown>|null,
 * }} p
 */
export async function startSpawnJobWallClock(env, p) {
  const spawnJobId = String(p.spawn_job_id || '').trim();
  if (!spawnJobId) throw new Error('spawn_job_id_required');
  const conversationId = String(p.conversation_id || '').trim();
  if (!conversationId) throw new Error('conversation_id_required');
  const hasCountdown =
    (Number.isFinite(Number(p.duration_seconds)) && Number(p.duration_seconds) > 0) ||
    (Number.isFinite(Number(p.ends_at_unix)) && Number(p.ends_at_unix) > 0);
  if (!hasCountdown) throw new Error('spawn_job_timeout_required');
  return startActiveTimer(env, {
    tenant_id: p.tenant_id,
    workspace_id: p.workspace_id,
    user_id: p.user_id,
    person_uuid: p.person_uuid,
    subject_type: 'spawn_job',
    subject_id: spawnJobId,
    mode: p.mode || 'multitask',
    label: p.label != null ? String(p.label) : `spawn_job:${spawnJobId}`,
    timer_kind: 'countdown',
    duration_seconds: p.duration_seconds,
    ends_at_unix: p.ends_at_unix,
    conversation_id: conversationId,
    agent_run_id: p.agent_run_id ?? null,
    spawn_job_id: spawnJobId,
    metadata: p.metadata ?? null,
  });
}

/**
 * Mandatory per-child agent_run countdown under a spawn_job.
 * @param {unknown} env
 * @param {{
 *   tenant_id: string,
 *   workspace_id?: string|null,
 *   user_id?: string|null,
 *   person_uuid?: string|null,
 *   spawn_job_id: string,
 *   spawn_session_id?: string|null,
 *   agent_run_id: string,
 *   mode?: string|null,
 *   conversation_id?: string|null,
 *   label?: string|null,
 *   duration_seconds?: number|null,
 *   ends_at_unix?: number|null,
 *   metadata?: Record<string, unknown>|null,
 * }} p
 */
export async function startSpawnChildTimer(env, p) {
  const spawnJobId = String(p.spawn_job_id || '').trim();
  const agentRunId = String(p.agent_run_id || '').trim();
  const conversationId = String(p.conversation_id || '').trim();
  if (!spawnJobId) throw new Error('spawn_job_id_required');
  if (!agentRunId) throw new Error('agent_run_id_required');
  if (!conversationId) throw new Error('conversation_id_required');
  const hasCountdown =
    (Number.isFinite(Number(p.duration_seconds)) && Number(p.duration_seconds) > 0) ||
    (Number.isFinite(Number(p.ends_at_unix)) && Number(p.ends_at_unix) > 0);
  if (!hasCountdown) throw new Error('child_timeout_required');
  return startActiveTimer(env, {
    tenant_id: p.tenant_id,
    workspace_id: p.workspace_id,
    user_id: p.user_id,
    person_uuid: p.person_uuid,
    subject_type: 'agent_run',
    subject_id: agentRunId,
    mode: p.mode || 'agent',
    label: p.label != null ? String(p.label) : `child:${agentRunId}`,
    timer_kind: 'countdown',
    duration_seconds: p.duration_seconds,
    ends_at_unix: p.ends_at_unix,
    conversation_id: conversationId,
    agent_run_id: agentRunId,
    spawn_job_id: spawnJobId,
    spawn_session_id: p.spawn_session_id ?? null,
    metadata: p.metadata ?? null,
  });
}

/**
 * Stop every still-running timer tied to a spawn_job (children + wall clock).
 * @param {unknown} env
 * @param {string} spawnJobId
 * @param {'completed'|'cancelled'|'expired'} [status]
 */
export async function stopAllTimersForSpawnJob(env, spawnJobId, status = 'completed') {
  if (!env?.DB) throw new Error('Database not configured');
  const sid = String(spawnJobId || '').trim();
  if (!sid) throw new Error('spawn_job_id_required');
  const { results } = await env.DB.prepare(
    `SELECT id FROM active_timers
     WHERE spawn_job_id = ? AND status IN ('running', 'paused')`,
  )
    .bind(sid)
    .all();
  let stopped = 0;
  for (const r of results || []) {
    await stopActiveTimer(env, r.id, status);
    stopped += 1;
  }
  return { ok: true, stopped };
}

/**
 * Mark countdown timers past ends_at_unix as expired.
 * When a spawn_job wall clock expires, force-cancel that fanout.
 * @param {unknown} env
 * @param {{ limit?: number }} [opts]
 */
export async function expireDueCountdowns(env, opts = {}) {
  if (!env?.DB) return { ok: false, expired: 0, cancelled_spawn_jobs: 0 };
  const limit = Math.min(200, Math.max(1, Math.floor(Number(opts.limit) || 50)));
  const now = Math.floor(Date.now() / 1000);
  const { results } = await env.DB.prepare(
    `SELECT id, subject_type, subject_id, spawn_job_id, user_id, workspace_id
     FROM active_timers
     WHERE status = 'running' AND timer_kind = 'countdown'
       AND ends_at_unix IS NOT NULL AND ends_at_unix <= ?
     LIMIT ?`,
  )
    .bind(now, limit)
    .all();

  let expired = 0;
  let cancelledSpawnJobs = 0;
  const spawnJobsToCancel = new Map();
  for (const r of results || []) {
    await stopActiveTimer(env, r.id, 'expired');
    expired += 1;
    const sj =
      (r.spawn_job_id && String(r.spawn_job_id).trim()) ||
      (String(r.subject_type || '') === 'spawn_job' ? String(r.subject_id || '').trim() : '');
    if (sj && !spawnJobsToCancel.has(sj)) {
      spawnJobsToCancel.set(sj, {
        userId: r.user_id != null ? String(r.user_id).trim() : '',
        workspaceId: r.workspace_id != null ? String(r.workspace_id).trim() : '',
      });
    }
  }

  if (spawnJobsToCancel.size) {
    try {
      const { cancelMultitaskFanout } = await import('../../backend/agentsam/runtime/spawn/orchestrator.js');
      for (const [spawnJobId, scope] of spawnJobsToCancel) {
        const job = await env.DB.prepare(
          `SELECT id, user_id, workspace_id, status FROM agentsam_spawn_job WHERE id = ? LIMIT 1`,
        )
          .bind(spawnJobId)
          .first()
          .catch(() => null);
        if (!job?.id) continue;
        if (['completed', 'partial', 'failed', 'cancelled'].includes(String(job.status || ''))) {
          continue;
        }
        const out = await cancelMultitaskFanout(env, {
          userId: scope.userId || String(job.user_id || '').trim(),
          workspaceId: scope.workspaceId || String(job.workspace_id || '').trim(),
          spawnJobId,
          reason: 'countdown_expired',
        }).catch((e) => {
          console.warn('[active-timers] countdown_cancel_spawn', spawnJobId, e?.message ?? e);
          return null;
        });
        if (out?.ok) cancelledSpawnJobs += 1;
      }
    } catch (e) {
      console.warn('[active-timers] countdown_cancel_import', e?.message ?? e);
    }
  }

  return { ok: true, expired, cancelled_spawn_jobs: cancelledSpawnJobs };
}
