/**
 * agentsam_tickets — D1 index over plans/*.md (doc_path = prose SSOT).
 *
 * Platform engineering and Collaborate Tasks share this ticket spine. `surface`
 * keeps Collaborate work outside Library and engineering proof workflows.
 */

export const TICKET_STATUSES = Object.freeze([
  'backlog',
  'active',
  'blocked',
  'in_review',
  'shipped',
  'abandoned',
]);

const CLOSED = new Set(['shipped', 'abandoned']);
const TICKET_SURFACES = new Set(['platform', 'collaborate']);

function normalizeSurface(value, fallback = 'platform') {
  const surface = String(value ?? fallback)
    .trim()
    .toLowerCase();
  if (!TICKET_SURFACES.has(surface)) throw new Error(`invalid_surface:${surface}`);
  return surface;
}

function normalizeDueAt(value) {
  if (value == null || value === '') return null;
  const dueAt = Number(value);
  if (!Number.isSafeInteger(dueAt)) throw new Error('invalid_due_at');
  return dueAt;
}

/**
 * @param {string} status
 */
export function isTicketStatus(status) {
  return TICKET_STATUSES.includes(String(status || '').trim());
}

/**
 * @param {{ from?: string | null, to: string, status_reason?: string | null }} p
 */
export function assertStatusTransition(p) {
  const to = String(p.to || '').trim();
  if (!isTicketStatus(to)) throw new Error(`invalid_status:${to}`);
  if ((to === 'blocked' || to === 'abandoned') && !String(p.status_reason || '').trim()) {
    throw new Error('status_reason required when status is blocked or abandoned');
  }
  return to;
}

/**
 * @param {unknown} v
 * @returns {string[]}
 */
function parseJsonArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x)).filter(Boolean);
    } catch {
      /* ignore */
    }
  }
  return [];
}

/**
 * @param {Record<string, unknown>} row
 */
export function mapTicketRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    status_reason: row.status_reason ?? null,
    project: row.project ?? null,
    client_id: row.client_id ?? null,
    subsystem: row.subsystem ?? null,
    tags: parseJsonArray(row.tags),
    priority: row.priority ?? null,
    doc_path: row.doc_path ?? null,
    blocks: parseJsonArray(row.blocks),
    blocked_by: parseJsonArray(row.blocked_by),
    supersedes: row.supersedes ?? null,
    due_at: row.due_at ?? null,
    surface: row.surface ?? 'platform',
    consecutive_pass_count: row.consecutive_pass_count ?? 0,
    required_pass_count: row.required_pass_count ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    closed_at: row.closed_at ?? null,
  };
}

/**
 * @param {unknown} env
 * @param {{
 *   status?: string | null,
 *   project?: string | null,
 *   subsystem?: string | null,
 *   priority?: string | null,
 *   client_id?: string | null,
 *   workable?: boolean,
 *   starred?: boolean,
 *   q?: string | null,
 *   surface?: string | null,
 *   limit?: number,
 * }} [q]
 */
export async function listTickets(env, q = {}) {
  if (!env?.DB) throw new Error('Database not configured');
  let sql = `SELECT * FROM agentsam_tickets WHERE 1=1`;
  const binds = [];
  const surface = normalizeSurface(q.surface, 'platform');
  sql += ` AND surface = ?`;
  binds.push(surface);
  if (q.status) {
    sql += ` AND status = ?`;
    binds.push(String(q.status).trim());
  }
  if (q.project) {
    sql += ` AND project = ?`;
    binds.push(String(q.project).trim());
  }
  if (q.subsystem) {
    sql += ` AND subsystem = ?`;
    binds.push(String(q.subsystem).trim());
  }
  if (q.priority) {
    sql += ` AND priority = ?`;
    binds.push(String(q.priority).trim());
  }
  if (q.client_id) {
    sql += ` AND client_id = ?`;
    binds.push(String(q.client_id).trim());
  }
  if (q.starred) {
    sql += ` AND EXISTS (
      SELECT 1 FROM json_each(CASE WHEN json_valid(tags) THEN tags ELSE '[]' END)
      WHERE json_each.value = 'starred'
    )`;
  }
  if (q.q != null && String(q.q).trim()) {
    const search = `%${String(q.q).trim()}%`;
    sql += ` AND (title LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE)`;
    binds.push(search, search);
  }
  sql += ` ORDER BY
    CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 9 END,
    updated_at DESC
    LIMIT ?`;
  binds.push(Math.min(500, Math.max(1, Number(q.limit) || 100)));

  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  let tickets = (results || []).map(mapTicketRow);

  if (q.workable) {
    const byId = new Map(tickets.map((t) => [t.id, t]));
    // Also need blocker status — refetch all non-closed for graph if filtered list incomplete
    const { results: allRows } = await env.DB.prepare(
      `SELECT id, status FROM agentsam_tickets WHERE surface = ?`,
    )
      .bind(surface)
      .all();
    const statusById = new Map((allRows || []).map((r) => [String(r.id), String(r.status)]));
    tickets = tickets.filter((t) => {
      if (t.status !== 'active' && t.status !== 'in_review') return false;
      const blockers = t.blocked_by || [];
      if (!blockers.length) return true;
      return blockers.every((id) => {
        const st = statusById.get(id);
        return st === 'shipped' || st === 'abandoned';
      });
    });
    void byId;
  }

  return tickets;
}

/**
 * @param {unknown} env
 * @param {string} id
 */
export async function getTicket(env, id) {
  if (!env?.DB) throw new Error('Database not configured');
  const tid = String(id || '').trim();
  if (!tid) return null;
  const row = await env.DB.prepare(`SELECT * FROM agentsam_tickets WHERE id = ? LIMIT 1`)
    .bind(tid)
    .first();
  return mapTicketRow(row);
}

/**
 * @param {unknown} env
 * @param {string} ticketId
 * @param {number} [limit]
 */
export async function listTicketEvents(env, ticketId, limit = 50) {
  if (!env?.DB) throw new Error('Database not configured');
  const { results } = await env.DB.prepare(
    `SELECT * FROM agentsam_ticket_events WHERE ticket_id = ? ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(String(ticketId), Math.min(200, Math.max(1, Number(limit) || 50)))
    .all();
  return results || [];
}

/**
 * @param {unknown} env
 * @param {{
 *   ticket_id: string,
 *   event_type: string,
 *   from_status?: string | null,
 *   to_status?: string | null,
 *   detail?: string | null,
 *   commit_sha?: string | null,
 * }} ev
 */
async function insertEvent(env, ev) {
  const id = `tke_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO agentsam_ticket_events (
       id, ticket_id, event_type, from_status, to_status, detail, commit_sha,
       actor_type, actor_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      ev.ticket_id,
      ev.event_type,
      ev.from_status ?? null,
      ev.to_status ?? null,
      ev.detail != null ? String(ev.detail).slice(0, 4000) : null,
      ev.commit_sha != null ? String(ev.commit_sha).slice(0, 64) : null,
      ev.actor_type != null ? String(ev.actor_type).slice(0, 40) : null,
      ev.actor_id != null ? String(ev.actor_id).slice(0, 120) : null,
      now,
    )
    .run();
  return id;
}

/**
 * @param {unknown} env
 * @param {{
 *   title: string,
 *   description?: string | null,
 *   status?: string,
 *   status_reason?: string | null,
 *   project?: string | null,
 *   client_id?: string | null,
 *   subsystem?: string | null,
 *   tags?: string[] | string | null,
 *   priority?: string | null,
 *   doc_path?: string | null,
 *   blocks?: string[] | null,
 *   blocked_by?: string[] | null,
 *   supersedes?: string | null,
 *   due_at?: number | null,
 *   surface?: string | null,
 *   id?: string | null,
 * }} body
 */
export async function createTicket(env, body) {
  if (!env?.DB) throw new Error('Database not configured');
  const title = String(body.title || '').trim();
  if (!title) throw new Error('title required');
  const status = assertStatusTransition({
    to: body.status || 'backlog',
    status_reason: body.status_reason,
  });
  const dedupKey =
    body.dedup_key != null && String(body.dedup_key).trim()
      ? String(body.dedup_key).trim().slice(0, 128)
      : null;
  if (dedupKey) {
    const existing = await env.DB.prepare(
      `SELECT id FROM agentsam_tickets WHERE dedup_key = ? LIMIT 1`,
    )
      .bind(dedupKey)
      .first();
    if (existing?.id) {
      return getTicket(env, existing.id);
    }
  }
  const id =
    (body.id != null && String(body.id).trim()) ||
    `tkt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Math.floor(Date.now() / 1000);
  const tags = parseJsonArray(body.tags);
  const blocks = parseJsonArray(body.blocks);
  const blockedBy = parseJsonArray(body.blocked_by);
  const surface = normalizeSurface(body.surface, 'platform');
  const requiredPassCount = surface === 'collaborate' ? 0 : 2;
  const dueAt = normalizeDueAt(body.due_at);

  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_tickets (
         id, title, description, status, status_reason, project, client_id, subsystem,
         tags, priority, doc_path, blocks, blocked_by, supersedes, due_at, surface,
         dedup_key, required_pass_count, created_at, updated_at, closed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        title.slice(0, 240),
        body.description != null ? String(body.description).slice(0, 20000) : null,
        status,
        body.status_reason != null ? String(body.status_reason).slice(0, 1000) : null,
        body.project != null ? String(body.project).slice(0, 120) : null,
        body.client_id != null ? String(body.client_id).slice(0, 120) : null,
        body.subsystem != null ? String(body.subsystem).slice(0, 120) : null,
        JSON.stringify(tags),
        body.priority != null ? String(body.priority).slice(0, 8) : null,
        body.doc_path != null ? String(body.doc_path).slice(0, 400) : null,
        JSON.stringify(blocks),
        JSON.stringify(blockedBy),
        body.supersedes != null ? String(body.supersedes).slice(0, 64) : null,
        dueAt,
        surface,
        dedupKey,
        requiredPassCount,
        now,
        now,
        CLOSED.has(status) ? now : null,
      )
      .run();
  } catch (e) {
    const msg = e?.message != null ? String(e.message) : '';
    if (dedupKey && /UNIQUE|constraint/i.test(msg)) {
      const again = await env.DB.prepare(
        `SELECT id FROM agentsam_tickets WHERE dedup_key = ? LIMIT 1`,
      )
        .bind(dedupKey)
        .first();
      if (again?.id) return getTicket(env, again.id);
    }
    throw e;
  }

  await insertEvent(env, {
    ticket_id: id,
    event_type: 'status_change',
    from_status: null,
    to_status: status,
    detail: 'created',
    actor_type: body.actor_type ?? 'dashboard_user',
    actor_id: body.actor_id ?? null,
  });

  return getTicket(env, id);
}

/**
 * Field update (not status — use setTicketStatus).
 * @param {unknown} env
 * @param {string} id
 * @param {Record<string, unknown>} patch
 */
export async function updateTicketFields(env, id, patch) {
  if (!env?.DB) throw new Error('Database not configured');
  const tid = String(id || '').trim();
  const existing = await getTicket(env, tid);
  if (!existing) throw new Error('ticket_not_found');

  const title = patch.title != null ? String(patch.title).trim().slice(0, 240) : existing.title;
  const project =
    patch.project !== undefined
      ? patch.project == null
        ? null
        : String(patch.project).slice(0, 120)
      : existing.project;
  const description =
    patch.description !== undefined
      ? patch.description == null
        ? null
        : String(patch.description).slice(0, 20000)
      : existing.description;
  const clientId =
    patch.client_id !== undefined
      ? patch.client_id == null
        ? null
        : String(patch.client_id).slice(0, 120)
      : existing.client_id;
  const subsystem =
    patch.subsystem !== undefined
      ? patch.subsystem == null
        ? null
        : String(patch.subsystem).slice(0, 120)
      : existing.subsystem;
  const priority =
    patch.priority !== undefined
      ? patch.priority == null
        ? null
        : String(patch.priority).slice(0, 8)
      : existing.priority;
  const docPath =
    patch.doc_path !== undefined
      ? patch.doc_path == null
        ? null
        : String(patch.doc_path).slice(0, 400)
      : existing.doc_path;
  const tags = patch.tags !== undefined ? parseJsonArray(patch.tags) : existing.tags;
  const blocks = patch.blocks !== undefined ? parseJsonArray(patch.blocks) : existing.blocks;
  const blockedBy =
    patch.blocked_by !== undefined ? parseJsonArray(patch.blocked_by) : existing.blocked_by;
  const supersedes =
    patch.supersedes !== undefined
      ? patch.supersedes == null
        ? null
        : String(patch.supersedes).slice(0, 64)
      : existing.supersedes;
  const dueAt = patch.due_at !== undefined ? normalizeDueAt(patch.due_at) : existing.due_at;
  const surface =
    patch.surface !== undefined ? normalizeSurface(patch.surface) : existing.surface || 'platform';
  const requiredPassCount =
    surface === 'collaborate'
      ? 0
      : existing.surface === 'collaborate'
        ? 1
        : existing.required_pass_count ?? 1;

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE agentsam_tickets SET
       title = ?, description = ?, project = ?, client_id = ?, subsystem = ?, tags = ?,
       priority = ?, doc_path = ?, blocks = ?, blocked_by = ?, supersedes = ?, due_at = ?,
       surface = ?, required_pass_count = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      title,
      description,
      project,
      clientId,
      subsystem,
      JSON.stringify(tags),
      priority,
      docPath,
      JSON.stringify(blocks),
      JSON.stringify(blockedBy),
      supersedes,
      dueAt,
      surface,
      requiredPassCount,
      now,
      tid,
    )
    .run();

  await insertEvent(env, {
    ticket_id: tid,
    event_type: 'note',
    detail: 'fields_updated',
  });

  return getTicket(env, tid);
}

/**
 * @param {unknown} env
 * @param {string} id
 * @param {{ status: string, status_reason?: string | null }} body
 */
export async function setTicketStatus(env, id, body) {
  if (!env?.DB) throw new Error('Database not configured');
  const tid = String(id || '').trim();
  const existing = await getTicket(env, tid);
  if (!existing) throw new Error('ticket_not_found');

  const to = assertStatusTransition({
    from: existing.status,
    to: body.status,
    status_reason: body.status_reason,
  });
  const reason =
    to === 'blocked' || to === 'abandoned'
      ? String(body.status_reason).trim().slice(0, 1000)
      : body.status_reason != null
        ? String(body.status_reason).trim().slice(0, 1000) || null
        : existing.status_reason;

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE agentsam_tickets SET
       status = ?, status_reason = ?, updated_at = ?, closed_at = ?
     WHERE id = ?`,
  )
    .bind(to, reason, now, CLOSED.has(to) ? now : null, tid)
    .run();

  await insertEvent(env, {
    ticket_id: tid,
    event_type: 'status_change',
    from_status: existing.status,
    to_status: to,
    detail: reason,
    actor_type: body.actor_type ?? null,
    actor_id: body.actor_id ?? null,
  });

  return getTicket(env, tid);
}

/**
 * @param {unknown} env
 * @param {string} id
 * @param {{ event_type: string, detail?: string | null, commit_sha?: string | null }} body
 */
export async function addTicketEvent(env, id, body) {
  if (!env?.DB) throw new Error('Database not configured');
  const tid = String(id || '').trim();
  const existing = await getTicket(env, tid);
  if (!existing) throw new Error('ticket_not_found');

  const eventType = String(body.event_type || '').trim();
  if (
    !['note', 'commit_linked', 'gate_passed', 'gate_failed', 'attachment', 'e2e_pass'].includes(
      eventType,
    )
  ) {
    throw new Error('invalid_event_type');
  }

  const eventId = await insertEvent(env, {
    ticket_id: tid,
    event_type: eventType,
    detail: body.detail,
    commit_sha: body.commit_sha,
    actor_type: body.actor_type ?? null,
    actor_id: body.actor_id ?? null,
  });

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`UPDATE agentsam_tickets SET updated_at = ? WHERE id = ?`)
    .bind(now, tid)
    .run();

  return { ok: true, event_id: eventId, ticket_id: tid };
}

/**
 * Hard-delete a ticket and its events. Scrubs id from other tickets' blocks/blocked_by.
 * @param {unknown} env
 * @param {string} id
 */
export async function deleteTicket(env, id) {
  if (!env?.DB) throw new Error('Database not configured');
  const tid = String(id || '').trim();
  if (!tid) throw new Error('ticket_id required');
  const existing = await getTicket(env, tid);
  if (!existing) throw new Error('ticket_not_found');

  const like = `%${tid}%`;
  const { results: linked } = await env.DB.prepare(
    `SELECT id, blocks, blocked_by FROM agentsam_tickets
     WHERE id != ? AND (blocks LIKE ? OR blocked_by LIKE ?)`,
  )
    .bind(tid, like, like)
    .all();

  const now = Math.floor(Date.now() / 1000);
  for (const row of linked || []) {
    const blocks = parseJsonArray(row.blocks);
    const blockedBy = parseJsonArray(row.blocked_by);
    const nextBlocks = blocks.filter((x) => x !== tid);
    const nextBlockedBy = blockedBy.filter((x) => x !== tid);
    if (nextBlocks.length === blocks.length && nextBlockedBy.length === blockedBy.length) continue;
    await env.DB.prepare(
      `UPDATE agentsam_tickets SET blocks = ?, blocked_by = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(JSON.stringify(nextBlocks), JSON.stringify(nextBlockedBy), now, row.id)
      .run();
  }

  await env.DB.prepare(`DELETE FROM agentsam_ticket_events WHERE ticket_id = ?`).bind(tid).run();
  try {
    await env.DB.prepare(`DELETE FROM agentsam_gate_runs WHERE ticket_id = ?`).bind(tid).run();
  } catch {
    /* table may be absent in some envs */
  }
  await env.DB.prepare(`DELETE FROM agentsam_tickets WHERE id = ?`).bind(tid).run();

  return { ok: true, deleted_id: tid };
}

/**
 * Analytics for Tickets UI — throughput, cycle time, status mix, aging.
 * @param {unknown} env
 */
export async function getTicketAnalytics(env) {
  if (!env?.DB) throw new Error('Database not configured');

  const statusRows = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n
     FROM agentsam_tickets
     WHERE surface = 'platform'
     GROUP BY status`,
  )
    .all()
    .then((r) => r.results || [])
    .catch(() => []);

  const byStatus = {};
  let total = 0;
  for (const row of statusRows) {
    const s = String(row.status || 'unknown');
    const n = Number(row.n) || 0;
    byStatus[s] = n;
    total += n;
  }
  const shipped = byStatus.shipped || 0;
  const openish = (byStatus.active || 0) + (byStatus.in_review || 0) + (byStatus.blocked || 0);
  const completionRate = total > 0 ? shipped / total : 0;

  // D1 SQLite: use CASE COUNT instead of FILTER for broader compatibility
  const throughput = await env.DB.prepare(
    `SELECT
       strftime('%Y-%W', datetime(e.created_at, 'unixepoch')) AS week,
       SUM(CASE WHEN e.event_type = 'status_change' AND e.to_status = 'shipped' THEN 1 ELSE 0 END) AS shipped
     FROM agentsam_ticket_events e
     INNER JOIN agentsam_tickets t ON t.id = e.ticket_id
     WHERE e.created_at >= unixepoch('now', '-56 days')
       AND t.surface = 'platform'
     GROUP BY week
     ORDER BY week DESC
     LIMIT 8`,
  )
    .all()
    .then((r) => r.results || [])
    .catch(() => []);

  const cycleRows = await env.DB.prepare(
    `SELECT
       t.id,
       (ship.first_shipped - act.first_active) AS cycle_sec
     FROM agentsam_tickets t
     INNER JOIN (
       SELECT ticket_id, MIN(created_at) AS first_active
       FROM agentsam_ticket_events
       WHERE event_type = 'status_change' AND to_status = 'active'
       GROUP BY ticket_id
     ) act ON act.ticket_id = t.id
     INNER JOIN (
       SELECT ticket_id, MIN(created_at) AS first_shipped
       FROM agentsam_ticket_events
       WHERE event_type = 'status_change' AND to_status = 'shipped'
       GROUP BY ticket_id
     ) ship ON ship.ticket_id = t.id
     WHERE ship.first_shipped >= act.first_active
       AND t.surface = 'platform'`,
  )
    .all()
    .then((r) => r.results || [])
    .catch(() => []);

  let cycleSum = 0;
  let cycleN = 0;
  for (const row of cycleRows) {
    const sec = Number(row.cycle_sec);
    if (Number.isFinite(sec) && sec >= 0) {
      cycleSum += sec;
      cycleN += 1;
    }
  }
  const avgCycleDays = cycleN > 0 ? cycleSum / cycleN / 86400 : null;

  const aging = await env.DB.prepare(
    `SELECT id, title, status, priority,
            CAST((julianday('now') - julianday(datetime(updated_at, 'unixepoch'))) AS INTEGER) AS days_in_status
     FROM agentsam_tickets
     WHERE status IN ('active', 'blocked')
       AND surface = 'platform'
     ORDER BY days_in_status DESC
     LIMIT 20`,
  )
    .all()
    .then((r) => r.results || [])
    .catch(() => []);

  const oldestActiveDays =
    aging.length && Number.isFinite(Number(aging[0].days_in_status))
      ? Number(aging[0].days_in_status)
      : 0;

  return {
    completion_rate: completionRate,
    avg_cycle_days: avgCycleDays,
    oldest_active_days: oldestActiveDays,
    by_status: byStatus,
    throughput: [...throughput].reverse(),
    aging,
  };
}
