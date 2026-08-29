const TICKET_STATUSES = new Set(['backlog', 'active', 'blocked', 'in_review', 'shipped', 'abandoned']);
const CLOSED_STATUSES = new Set(['shipped', 'abandoned']);

function text(value, max = 1000) {
  const out = value == null ? '' : String(value).trim();
  return out ? out.slice(0, max) : '';
}

function jsonArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
    } catch {}
  }
  return [];
}

function mapTicket(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    status_reason: row.status_reason ?? null,
    project: row.project ?? null,
    subsystem: row.subsystem ?? null,
    tags: jsonArray(row.tags),
    priority: row.priority ?? null,
    doc_path: row.doc_path ?? null,
    blocks: jsonArray(row.blocks),
    blocked_by: jsonArray(row.blocked_by),
    dedup_key: row.dedup_key ?? null,
    surface: row.surface ?? 'platform',
    created_at: row.created_at,
    updated_at: row.updated_at,
    closed_at: row.closed_at ?? null,
  };
}

function requireStatus(status, reason) {
  const value = text(status, 40);
  if (!TICKET_STATUSES.has(value)) throw new Error(`invalid_status:${value}`);
  if ((value === 'blocked' || value === 'abandoned') && !text(reason, 1000)) {
    throw new Error('status_reason_required');
  }
  return value;
}

async function insertEvent(env, event) {
  const id = `tke_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO agentsam_ticket_events (
       id, ticket_id, event_type, from_status, to_status, detail, commit_sha,
       actor_type, actor_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    event.ticketId,
    event.eventType,
    event.fromStatus ?? null,
    event.toStatus ?? null,
    event.detail ? text(event.detail, 4000) : null,
    event.commitSha ? text(event.commitSha, 64) : null,
    event.actorType ? text(event.actorType, 40) : null,
    event.actorId ? text(event.actorId, 120) : null,
    now,
  ).run();
  return id;
}

export async function getTicket(env, ticketId) {
  const id = text(ticketId, 128);
  if (!id) return null;
  const row = await env.DB.prepare('SELECT * FROM agentsam_tickets WHERE id = ? LIMIT 1').bind(id).first();
  return mapTicket(row);
}

export async function listTickets(env, query = {}) {
  let sql = `SELECT * FROM agentsam_tickets WHERE surface = 'platform'`;
  const binds = [];
  if (query.status) {
    sql += ' AND status = ?';
    binds.push(text(query.status, 40));
  }
  if (query.project) {
    sql += ' AND project = ?';
    binds.push(text(query.project, 120));
  }
  if (query.subsystem) {
    sql += ' AND subsystem = ?';
    binds.push(text(query.subsystem, 120));
  }
  if (query.q) {
    const q = `%${text(query.q, 240)}%`;
    sql += ' AND (title LIKE ? COLLATE NOCASE OR description LIKE ? COLLATE NOCASE)';
    binds.push(q, q);
  }
  sql += ` ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 9 END, updated_at DESC LIMIT ?`;
  binds.push(Math.min(100, Math.max(1, Number(query.limit) || 30)));
  const result = await env.DB.prepare(sql).bind(...binds).all();
  return (result?.results || []).map(mapTicket);
}

export async function createTicket(env, body, actor = {}) {
  const title = text(body?.title, 240);
  if (!title) throw new Error('ticket_title_required');
  const status = requireStatus(body?.status || 'backlog', body?.status_reason);
  const dedupKey = text(body?.dedup_key, 128) || null;
  if (dedupKey) {
    const existing = await env.DB.prepare('SELECT id FROM agentsam_tickets WHERE dedup_key = ? LIMIT 1').bind(dedupKey).first();
    if (existing?.id) return getTicket(env, existing.id);
  }

  const id = text(body?.id, 128) || `tkt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_tickets (
         id, title, description, status, status_reason, project, subsystem,
         tags, priority, doc_path, blocks, blocked_by, surface, dedup_key,
         required_pass_count, created_at, updated_at, closed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'platform', ?, 2, ?, ?, ?)`,
    ).bind(
      id,
      title,
      body?.description ? text(body.description, 20000) : null,
      status,
      body?.status_reason ? text(body.status_reason, 1000) : null,
      body?.project ? text(body.project, 120) : null,
      body?.subsystem ? text(body.subsystem, 120) : null,
      JSON.stringify(jsonArray(body?.tags)),
      body?.priority ? text(body.priority, 8) : null,
      body?.doc_path ? text(body.doc_path, 400) : null,
      JSON.stringify(jsonArray(body?.blocks)),
      JSON.stringify(jsonArray(body?.blocked_by)),
      dedupKey,
      now,
      now,
      CLOSED_STATUSES.has(status) ? now : null,
    ).run();
  } catch (error) {
    if (dedupKey && /unique|constraint/i.test(String(error?.message || error))) {
      const existing = await env.DB.prepare('SELECT id FROM agentsam_tickets WHERE dedup_key = ? LIMIT 1').bind(dedupKey).first();
      if (existing?.id) return getTicket(env, existing.id);
    }
    throw error;
  }

  await insertEvent(env, {
    ticketId: id,
    eventType: 'status_change',
    toStatus: status,
    detail: 'created',
    actorType: actor.type || 'agent',
    actorId: actor.id || null,
  });
  return getTicket(env, id);
}

export async function setTicketStatus(env, ticketId, status, statusReason, actor = {}) {
  const existing = await getTicket(env, ticketId);
  if (!existing) throw new Error('ticket_not_found');
  const next = requireStatus(status, statusReason);
  const reason = statusReason ? text(statusReason, 1000) : null;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'UPDATE agentsam_tickets SET status = ?, status_reason = ?, updated_at = ?, closed_at = ? WHERE id = ?',
  ).bind(next, reason, now, CLOSED_STATUSES.has(next) ? now : null, existing.id).run();
  await insertEvent(env, {
    ticketId: existing.id,
    eventType: 'status_change',
    fromStatus: existing.status,
    toStatus: next,
    detail: reason,
    actorType: actor.type || 'agent',
    actorId: actor.id || null,
  });
  return getTicket(env, existing.id);
}

export async function addTicketNote(env, ticketId, detail, commitSha, actor = {}) {
  const existing = await getTicket(env, ticketId);
  if (!existing) throw new Error('ticket_not_found');
  const note = text(detail, 4000);
  if (!note) throw new Error('ticket_note_required');
  const eventId = await insertEvent(env, {
    ticketId: existing.id,
    eventType: commitSha ? 'commit_linked' : 'note',
    detail: note,
    commitSha,
    actorType: actor.type || 'agent',
    actorId: actor.id || null,
  });
  await env.DB.prepare('UPDATE agentsam_tickets SET updated_at = ? WHERE id = ?')
    .bind(Math.floor(Date.now() / 1000), existing.id)
    .run();
  return { ok: true, ticket_id: existing.id, event_id: eventId };
}

export const RETRIEVAL_E2E_TICKET = Object.freeze({
  title: 'Wire AgentSamRemix hybrid retrieval end to end',
  status: 'active',
  project: 'AgentSamRemix',
  subsystem: 'retrieval',
  priority: 'P1',
  dedup_key: 'agentsamremix:retrieval:e2e:v1',
  tags: ['retrieval', 'ast-rag', 'dense', 'eval', 'migration'],
  description: [
    'Closure contract for the AgentSamRemix retrieval spine.',
    '',
    'Acceptance:',
    '- Agent tool invokes the same retrieval service as HTTP; no loopback or duplicate retrieval implementation.',
    '- Structural/lexical/graph retrieval pins one active code-index generation.',
    '- Dense ANN resolves an explicit embedding route and exact embedding_space_key; no provider/model/index defaults.',
    '- Retrieval observations persist through the canonical D1 schema authority.',
    '- A real repo eval set records Recall@K/MRR/NDCG, latency, and token efficiency.',
    '- No runtime imports from imports/agentsamfast or legacy src compatibility code.',
    '- Focused tests, typecheck, and production build are green before status can move to shipped.',
  ].join('\n'),
});

export async function ensureRetrievalE2ETicket(env, actor = {}) {
  return createTicket(env, RETRIEVAL_E2E_TICKET, actor);
}
