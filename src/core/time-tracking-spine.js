/**
 * Canonical time tracking — time_entries + time_projects + work_sessions.
 * Open timer: ended_at IS NULL. Never use project_time_entries (not on prod D1).
 */

/** @param {string|null|undefined} userId */
export function userIdVariants(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return [];
  const base = uid.replace(/^user_/, '');
  return [...new Set([uid, base, `user_${base}`].filter(Boolean))];
}

/**
 * D1 CHECK: source IN ('auto','manual','derived','import','backtrack').
 * Legacy callers used 'timer' / 'heartbeat' — map those to 'auto'.
 * @param {string|null|undefined} source
 */
export function normalizeTimeEntrySource(source) {
  const s = String(source || '').trim().toLowerCase();
  if (s === 'manual' || s === 'derived' || s === 'import' || s === 'backtrack' || s === 'auto') {
    return s;
  }
  // timer / heartbeat / unknown → autonomous tracking
  return 'auto';
}

/** @param {Record<string, unknown>|null|undefined} row @param {number} [nowSec] */
export function entryDurationSeconds(row, nowSec = Math.floor(Date.now() / 1000)) {
  if (!row) return 0;
  const started = Number(row.started_at || row.created_at || 0);
  if (started > 0) {
    const ended = row.ended_at != null && row.ended_at !== '' ? Number(row.ended_at) : nowSec;
    return Math.max(0, ended - started);
  }
  return Math.round(Number(row.hours || 0) * 3600);
}

/** @param {Record<string, unknown>|null|undefined} row */
export function isEntryOpen(row) {
  return !!row && (row.ended_at == null || row.ended_at === '');
}

/** @param {{ start: number, end: number }[]} intervals */
function mergedDurationSeconds(intervals) {
  if (!intervals?.length) return 0;
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  if (!sorted.length) return 0;
  let total = 0;
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    if (next.start <= cur.end) {
      cur.end = Math.max(cur.end, next.end);
    } else {
      total += cur.end - cur.start;
      cur = { ...next };
    }
  }
  return total + (cur.end - cur.start);
}

/** @param {Record<string, unknown>|null|undefined} row @param {number} dayStart @param {number} dayEnd @param {number} nowSec */
function clipEntryIntervalToDay(row, dayStart, dayEnd, nowSec) {
  if (!row) return null;
  const overlapStart = Math.max(Number(row.started_at || row.created_at || dayStart), dayStart);
  const overlapEnd = Math.min(row.ended_at != null && row.ended_at !== '' ? Number(row.ended_at) : nowSec, dayEnd);
  return overlapEnd > overlapStart ? { start: overlapStart, end: overlapEnd } : null;
}

/** @param {Record<string, unknown>|null|undefined} row */
export function extractTodoId(row) {
  const desc = String(row?.description || '');
  const m = desc.match(/todo_[a-z0-9]+/i);
  if (m) return m[0];
  try {
    const tags = JSON.parse(String(row?.tags_json || '[]'));
    if (Array.isArray(tags)) {
      const hit = tags.find((t) => String(t).startsWith('todo_'));
      if (hit) return String(hit);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @param {{ surface?: string|null, todoId?: string|null, projectRef?: string|null, note?: string|null }} p
 */
export function buildTimeEntryDescription(p) {
  const parts = [];
  if (p.surface) parts.push(String(p.surface).trim());
  if (p.note) parts.push(String(p.note).trim());
  if (p.todoId) parts.push(String(p.todoId).trim());
  if (p.projectRef) parts.push(String(p.projectRef).trim());
  return parts.filter(Boolean).join(' · ').slice(0, 500) || 'time';
}

/**
 * Resolve projects.id / time_projects.project_key / alias to catalog row.
 * @param {*} env
 * @param {string|null|undefined} projectRef
 */
export async function resolveTimeProjectRef(env, projectRef) {
  const ref = String(projectRef || '').trim();
  if (!ref || !env?.DB) {
    return {
      ref: ref || null,
      projectId: null,
      projectKey: null,
      projectName: ref || null,
      billable: 0,
      rateCents: 0,
    };
  }

  let projectRow = null;
  try {
    projectRow = await env.DB.prepare(
      `SELECT id, name, client_id FROM projects WHERE id = ? LIMIT 1`,
    ).bind(ref).first();
  } catch {
    /* optional */
  }

  let timeRow = null;
  try {
    timeRow = await env.DB.prepare(
      `SELECT project_key, label, projects_id, client_id, hourly_rate_cents, track_burn, billing_type
       FROM time_projects
       WHERE project_key = ?
          OR projects_id = ?
       LIMIT 1`,
    ).bind(ref, ref).first();
  } catch {
    /* optional */
  }

  if (!timeRow && projectRow?.id) {
    try {
      timeRow = await env.DB.prepare(
        `SELECT project_key, label, projects_id, client_id, hourly_rate_cents, track_burn, billing_type
         FROM time_projects
         WHERE projects_id = ?
         LIMIT 1`,
      ).bind(String(projectRow.id)).first();
    } catch {
      /* optional */
    }
  }

  const projectId = projectRow?.id
    ? String(projectRow.id)
    : (timeRow?.projects_id ? String(timeRow.projects_id) : ref);
  const projectKey = timeRow?.project_key ? String(timeRow.project_key) : ref;
  const projectName = projectRow?.name
    || timeRow?.label
    || projectKey
    || ref;
  const billable = timeRow?.track_burn === 1
    || String(timeRow?.billing_type || '').includes('client')
    || !!projectRow?.client_id
    ? 1
    : 0;

  return {
    ref,
    projectId,
    projectKey,
    projectName,
    billable,
    rateCents: Number(timeRow?.hourly_rate_cents || 0),
  };
}

/** @param {*} env @param {string} userId @param {{ exceptId?: string|null, endedAt?: number }} [opts] */
export async function closeOpenTimeEntries(env, userId, opts = {}) {
  if (!env?.DB || !userId) return 0;
  const endedAt = Number(opts.endedAt || Math.floor(Date.now() / 1000));
  const ids = userIdVariants(userId);
  let closed = 0;
  for (const uid of ids) {
    const { results } = await env.DB.prepare(
      `SELECT id, started_at FROM time_entries
       WHERE user_id = ? AND ended_at IS NULL
       ${opts.exceptId ? 'AND id != ?' : ''}`,
    ).bind(...(opts.exceptId ? [uid, opts.exceptId] : [uid])).all().catch(() => ({ results: [] }));
    for (const row of results || []) {
      const started = Number(row.started_at || endedAt);
      const hours = Math.max(0, (endedAt - started) / 3600);
      const r = await env.DB.prepare(
        `UPDATE time_entries
         SET ended_at = ?, hours = ?, updated_at = unixepoch()
         WHERE id = ? AND ended_at IS NULL`,
      ).bind(endedAt, hours, row.id).run().catch(() => null);
      closed += Number(r?.meta?.changes ?? r?.changes ?? 0);
    }
  }
  return closed;
}

/**
 * @param {*} env
 * @param {{ userId: string, tenantId?: string|null, workspaceId?: string|null, projectRef: string, description?: string|null, source?: string, billable?: number|null }} p
 */
export async function startProjectTimer(env, p) {
  if (!env?.DB) return { ok: false, error: 'no_db' };
  const userId = String(p.userId || '').trim();
  if (!userId) return { ok: false, error: 'user_required' };

  await closeOpenTimeEntries(env, userId);

  const resolved = await resolveTimeProjectRef(env, p.projectRef);
  const now = Math.floor(Date.now() / 1000);
  const entryId = `te_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const description = p.description?.trim()
    || buildTimeEntryDescription({ surface: 'project_detail', projectRef: resolved.projectName || resolved.projectId });

  await env.DB.prepare(
    `INSERT INTO time_entries (
       id, user_id, tenant_id, workspace_id, project_id, project_name,
       description, hours, rate_cents, started_at, ended_at, source, billable,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, unixepoch(), unixepoch())`,
  ).bind(
    entryId,
    userId,
    p.tenantId ?? null,
    p.workspaceId ?? null,
    resolved.projectId || resolved.projectKey,
    resolved.projectName,
    description,
    resolved.rateCents,
    now,
    normalizeTimeEntrySource(p.source || 'auto'),
    p.billable != null ? p.billable : resolved.billable,
  ).run();

  return {
    ok: true,
    entry_id: entryId,
    project_id: resolved.projectId || resolved.projectKey,
    project_key: resolved.projectKey,
    started_at: now,
  };
}

/**
 * @param {*} env
 * @param {string} userId
 * @param {{ projectRef?: string|null }} [opts]
 */
export async function stopActiveTimer(env, userId, opts = {}) {
  if (!env?.DB) return { ok: false, error: 'no_db' };
  const ids = userIdVariants(userId);
  const resolved = opts.projectRef ? await resolveTimeProjectRef(env, opts.projectRef) : null;
  const matchIds = resolved
    ? [resolved.projectId, resolved.projectKey, resolved.ref].filter(Boolean)
    : [];

  for (const uid of ids) {
    let row = null;
    if (matchIds.length) {
      const placeholders = matchIds.map(() => '?').join(',');
      row = await env.DB.prepare(
        `SELECT id, started_at, hours FROM time_entries
         WHERE user_id = ? AND ended_at IS NULL AND project_id IN (${placeholders})
         ORDER BY started_at DESC LIMIT 1`,
      ).bind(uid, ...matchIds).first().catch(() => null);
    }
    if (!row) {
      row = await env.DB.prepare(
        `SELECT id, started_at, hours FROM time_entries
         WHERE user_id = ? AND ended_at IS NULL
         ORDER BY started_at DESC LIMIT 1`,
      ).bind(uid).first().catch(() => null);
    }
    if (row?.id) {
      const endedAt = Math.floor(Date.now() / 1000);
      const hours = entryDurationSeconds(row, endedAt) / 3600;
      await env.DB.prepare(
        `UPDATE time_entries
         SET ended_at = ?, hours = ?, updated_at = unixepoch()
         WHERE id = ? AND ended_at IS NULL`,
      ).bind(endedAt, hours, row.id).run();
      return {
        ok: true,
        entry: {
          id: String(row.id),
          duration_seconds: entryDurationSeconds({ ...row, ended_at: endedAt }, endedAt),
          hours,
        },
      };
    }
  }
  return { ok: false, error: 'no_active_timer' };
}

/**
 * @param {*} env
 * @param {{ userId: string, tenantId?: string|null, workspaceId?: string|null, projectRef?: string|null, todoId?: string|null, surface?: string|null, beatSeconds?: number }} p
 */
export async function heartbeatActiveTimer(env, p) {
  if (!env?.DB) return { ok: false, error: 'no_db' };
  const userId = String(p.userId || '').trim();
  const projectRef = String(p.projectRef || '_session').trim() || '_session';
  const resolved = await resolveTimeProjectRef(env, projectRef === '_session' ? null : projectRef);
  const canonicalProject = projectRef === '_session'
    ? '_session'
    : (resolved.projectId || resolved.projectKey || projectRef);
  const todoId = p.todoId ? String(p.todoId).trim() : null;
  const surface = p.surface ? String(p.surface).trim() : 'collaborate';
  const description = buildTimeEntryDescription({
    surface,
    todoId,
    projectRef: canonicalProject === '_session' ? surface : (resolved.projectName || canonicalProject),
  });
  const now = Math.floor(Date.now() / 1000);

  const ids = userIdVariants(userId);
  let activeRow = null;
  for (const uid of ids) {
    activeRow = await env.DB.prepare(
      `SELECT id, project_id, description, started_at FROM time_entries
       WHERE user_id = ? AND ended_at IS NULL AND source IN ('auto', 'manual')
       ORDER BY started_at DESC LIMIT 1`,
    ).bind(uid).first().catch(() => null);
    if (activeRow) break;
  }

  const prevTodo = extractTodoId(activeRow);
  const prevProject = String(activeRow?.project_id || '');
  const contextChanged = activeRow?.id && (
    prevProject !== String(canonicalProject)
    || String(prevTodo || '') !== String(todoId || '')
  );

  if (contextChanged) {
    await stopActiveTimer(env, userId);
    activeRow = null;
  }

  if (activeRow?.id) {
    const hours = entryDurationSeconds(activeRow, now) / 3600;
    await env.DB.prepare(
      `UPDATE time_entries
       SET hours = ?, description = ?, updated_at = unixepoch()
       WHERE id = ?`,
    ).bind(hours, description, activeRow.id).run();
    return { ok: true, entry_id: String(activeRow.id), hours, running: true };
  }

  const started = await startProjectTimer(env, {
    userId,
    tenantId: p.tenantId ?? null,
    workspaceId: p.workspaceId ?? null,
    projectRef: canonicalProject === '_session' ? 'inneranimalmedia' : canonicalProject,
    description,
    source: 'auto',
  });
  return { ok: true, ...started, running: true };
}

/**
 * @param {*} env
 * @param {{ userId: string, tenantId?: string|null, workspaceId?: string|null, projectRef: string, minutes: number, todoId?: string|null, note?: string|null, entryDate?: string|null }} p
 */
export async function insertManualTimeEntry(env, p) {
  if (!env?.DB) return { ok: false, error: 'no_db' };
  const userId = String(p.userId || '').trim();
  const minutes = Math.min(Math.max(Math.round(Number(p.minutes) || 0), 1), 480);
  const resolved = await resolveTimeProjectRef(env, p.projectRef);
  const entryDateRaw = p.entryDate ? String(p.entryDate).trim().slice(0, 10) : null;
  const now = Math.floor(Date.now() / 1000);
  let startedAt = now - minutes * 60;
  if (entryDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(entryDateRaw)) {
    startedAt = Math.floor(new Date(`${entryDateRaw}T12:00:00`).getTime() / 1000);
  }
  const endedAt = startedAt + minutes * 60;
  const entryId = `te_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const description = buildTimeEntryDescription({
    surface: 'manual',
    note: p.note,
    todoId: p.todoId,
    projectRef: resolved.projectName || resolved.projectId,
  });

  await env.DB.prepare(
    `INSERT INTO time_entries (
       id, user_id, tenant_id, workspace_id, project_id, project_name,
       description, hours, rate_cents, started_at, ended_at, source, billable,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, unixepoch(), unixepoch())`,
  ).bind(
    entryId,
    userId,
    p.tenantId ?? null,
    p.workspaceId ?? null,
    resolved.projectId || resolved.projectKey,
    resolved.projectName,
    description,
    minutes / 60,
    resolved.rateCents,
    startedAt,
    endedAt,
    resolved.billable,
  ).run();

  return { ok: true, entry_id: entryId, minutes };
}

/**
 * @param {*} env
 * @param {string} userId
 * @param {{ fromIso?: string, toIso?: string, projectRef?: string|null }} [opts]
 */
export async function summarizeUserTime(env, userId, opts = {}) {
  if (!env?.DB) {
    return {
      todayMinutes: 0,
      activeTracking: false,
      activeEntry: null,
      byProject: [],
      byTask: [],
      entries: [],
    };
  }

  const ids = userIdVariants(userId);
  const placeholders = ids.map(() => '?').join(',');
  const fromDay = opts.fromIso ? String(opts.fromIso).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const toDay = opts.toIso ? String(opts.toIso).slice(0, 10) : fromDay;
  const dayStart = Math.floor(new Date(`${fromDay}T00:00:00`).getTime() / 1000);
  const dayEnd = Math.floor(new Date(`${toDay}T23:59:59`).getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);

  const { results } = await env.DB.prepare(
    `SELECT id, user_id, project_id, project_name, description, hours, source,
            started_at, ended_at, billable
     FROM time_entries
     WHERE user_id IN (${placeholders})
       AND (
         COALESCE(started_at, created_at) <= ?
         AND (ended_at IS NULL OR ended_at >= ?)
       )
     ORDER BY COALESCE(started_at, created_at) DESC`,
  ).bind(...ids, dayEnd, dayStart).all().catch(() => ({ results: [] }));

  const entries = results || [];
  let activeTracking = false;
  let activeEntry = null;
  const allClips = [];
  const byProjectClips = new Map();
  const byTaskClips = new Map();
  const focusRef = opts.projectRef ? await resolveTimeProjectRef(env, opts.projectRef) : null;
  const focusIds = focusRef
    ? [...new Set([focusRef.projectId, focusRef.projectKey, focusRef.ref].filter(Boolean))]
    : [];
  const focusClips = [];

  for (const row of entries) {
    const isLoginAuto = String(row.source || '') === 'auto'
      && /^Login session/i.test(String(row.description || ''));
    if (isLoginAuto) continue;

    const clip = clipEntryIntervalToDay(row, dayStart, dayEnd, now);
    if (!clip) continue;

    const secs = entryDurationSeconds(row, now);
    allClips.push(clip);

    if (isEntryOpen(row)) {
      activeTracking = true;
      if (!activeEntry || String(row.project_id) === String(opts.projectRef || '')) {
        activeEntry = {
          id: String(row.id),
          project_id: String(row.project_id || ''),
          started_at: row.started_at,
          duration_seconds: secs,
          hours: secs / 3600,
        };
      }
    }

    const pid = String(row.project_id || '').trim();
    // Never invent a project id — unattributed rows stay out of by-project totals.
    if (pid) {
      if (!byProjectClips.has(pid)) byProjectClips.set(pid, []);
      byProjectClips.get(pid).push(clip);
    }
    const todoId = extractTodoId(row);
    if (todoId) {
      if (!byTaskClips.has(todoId)) byTaskClips.set(todoId, []);
      byTaskClips.get(todoId).push(clip);
    }
    if (focusIds.length && focusIds.includes(String(row.project_id || ''))) {
      focusClips.push(clip);
    }
  }

  const todayMinutes = Math.round(mergedDurationSeconds(allClips) / 60);
  const byProjectMap = new Map(
    [...byProjectClips.entries()].map(([project_id, clips]) => [
      project_id,
      Math.round(mergedDurationSeconds(clips) / 60),
    ]),
  );
  const byTaskMap = new Map(
    [...byTaskClips.entries()].map(([todo_id, clips]) => [
      todo_id,
      Math.round(mergedDurationSeconds(clips) / 60),
    ]),
  );

  let projectTodayMinutes = 0;
  let projectActiveTracking = false;
  let projectActiveEntry = null;
  if (focusIds.length) {
    projectTodayMinutes = Math.round(mergedDurationSeconds(focusClips) / 60);
    for (const row of entries) {
      if (!focusIds.includes(String(row.project_id || ''))) continue;
      if (isEntryOpen(row)) {
        projectActiveTracking = true;
        projectActiveEntry = {
          id: String(row.id),
          project_id: String(row.project_id),
          started_at: row.started_at,
          duration_seconds: entryDurationSeconds(row, now),
        };
      }
    }
  }

  return {
    todayMinutes,
    activeTracking,
    activeEntry,
    byProject: [...byProjectMap.entries()].map(([project_id, minutes]) => ({ project_id, minutes })),
    byTask: [...byTaskMap.entries()].map(([todo_id, minutes]) => ({ todo_id, minutes })),
    entries,
    projectTodayMinutes,
    projectActiveTracking,
    projectActiveEntry,
  };
}

/** @param {*} env @param {string} userId @param {{ weekStart?: boolean, dayStart?: boolean }} [opts] */
export async function sumUserHours(env, userId, opts = {}) {
  if (!env?.DB) return 0;
  const ids = userIdVariants(userId);
  const placeholders = ids.map(() => '?').join(',');
  const now = Math.floor(Date.now() / 1000);
  let since = 0;
  if (opts.dayStart) {
    since = Math.floor(new Date(new Date().toISOString().slice(0, 10)).getTime() / 1000);
  } else if (opts.weekStart) {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    since = Math.floor(d.getTime() / 1000);
  }

  const { results } = await env.DB.prepare(
    `SELECT hours, started_at, ended_at FROM time_entries
     WHERE user_id IN (${placeholders})
       AND (ended_at IS NULL OR COALESCE(started_at, created_at) >= ?)`,
  ).bind(...ids, since).all().catch(() => ({ results: [] }));

  let total = 0;
  for (const row of results || []) {
    total += entryDurationSeconds(row, now) / 3600;
  }
  return Math.round(total * 100) / 100;
}
