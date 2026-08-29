/**
 * src/api/meet.js
 * Cloudflare Calls SFU proxy + room signaling + chat + invite
 */

import { jsonResponse } from '../core/responses.js';
import { getAuthUser } from '../core/auth.js';
import { platformR2WriteGateResponse } from '../core/r2-storage-scope.js';
import { resolveIdentity } from '../core/identity.js';
import {
  assertCanInviteToRoom,
  formatMeetScheduleLabel,
  insertMeetRoomRow,
  isValidInviteEmail,
  meetJoinUrl,
  normalizeInviteEmails,
  sendMeetInvites,
  validateMeetInviteLink,
} from '../core/meet-shared.js';

const CALLS_BASE = 'https://rtc.live.cloudflare.com/v1';
const TURN_BASE  = 'https://rtc.live.cloudflare.com/v1/turn/keys';

function resolveWorkspaceIdLoose(authUser, env, body = null, url = null) {
  const fromSession = authUser?.workspace_id ?? authUser?.workspaceId ?? null;
  if (fromSession && String(fromSession).trim()) return String(fromSession).trim();
  const fromBody = body?.workspace_id ?? body?.workspaceId ?? null;
  if (fromBody && String(fromBody).trim()) return String(fromBody).trim();
  const fromQuery = url?.searchParams?.get('workspace_id') ?? null;
  if (fromQuery && String(fromQuery).trim()) return String(fromQuery).trim();
  const fromEnv = env?.WORKSPACE_ID ?? null;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim();
  return null;
}

function resolveTenantIdLoose(authUser) {
  const tid = authUser?.tenant_id ?? authUser?.tenantId ?? null;
  return tid != null && String(tid).trim() !== '' ? String(tid).trim() : null;
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function genRoomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getUserId(request, env) {
  const user = await getAuthUser(request, env);
  const userId = user?.id || user?.userId || user?.user_id;
  return { user, userId };
}

async function callsRequest(env, path, method = 'GET', body = null) {
  const appId = env?.CLOUDFLARE_CALLS_APP_ID != null ? String(env.CLOUDFLARE_CALLS_APP_ID).trim() : '';
  const appSecret = env?.CLOUDFLARE_CALLS_APP_SECRET != null ? String(env.CLOUDFLARE_CALLS_APP_SECRET).trim() : '';
  if (!appId || !appSecret) {
    throw new Error(
      'Cloudflare Calls is not configured on this worker (CLOUDFLARE_CALLS_APP_ID / CLOUDFLARE_CALLS_APP_SECRET).',
    );
  }
  const url  = `${CALLS_BASE}/apps/${appId}${path}`;
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${appSecret}`,
      'Content-Type':  'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calls API ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function ensureMeetMessagesTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS meet_messages (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      room_id TEXT NOT NULL,
      channel_id TEXT,
      workspace_id TEXT,
      user_id TEXT,
      display_name TEXT,
      content TEXT NOT NULL,
      message_type TEXT DEFAULT 'chat' CHECK(message_type IN ('chat','system','reaction','file')),
      is_archived INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
}

/** Channel row `type` must stay `'system'` for Meet Chat (not tenant_id — see SELECT above). */
const MEET_CHAT_CHANNEL_TYPE = 'system';

async function ensureMeetChatChannelId(db, env, { workspaceId, tenantId, createdBy }) {
  if (!workspaceId) return null;

  // Try the "desired" schema first (workspace_id + type + slug).
  try {
    const row = await db.prepare(
      "SELECT id FROM channels WHERE workspace_id=? AND type='system' AND slug='meet-chat' LIMIT 1"
    ).bind(workspaceId).first();
    if (row?.id) return row.id;
  } catch { /* continue */ }

  // Fallback: workspace_id + slug only
  try {
    const row = await db.prepare(
      "SELECT id FROM channels WHERE workspace_id=? AND slug='meet-chat' LIMIT 1"
    ).bind(workspaceId).first();
    if (row?.id) return row.id;
  } catch { /* continue */ }

  // Fallback: workspace_id + name
  try {
    const row = await db.prepare(
      "SELECT id FROM channels WHERE workspace_id=? AND name='Meet Chat' LIMIT 1"
    ).bind(workspaceId).first();
    if (row?.id) return row.id;
  } catch { /* continue */ }

  // Create (best-effort with multiple column sets).
  const chId = newId('ch');
  const tId =
    tenantId != null && String(tenantId).trim() !== ''
      ? String(tenantId).trim()
      : 'system'; // system-scoped: no authenticated user context at this path
  const by = createdBy ?? null;

  const inserts = [
    {
      sql: `INSERT OR IGNORE INTO channels
              (id, workspace_id, tenant_id, name, slug, description, type, created_by)
            VALUES (?, ?, ?, 'Meet Chat', 'meet-chat', 'Persistent chat from video sessions', ?, ?)`,
      binds: [chId, workspaceId, tId, MEET_CHAT_CHANNEL_TYPE, by],
    },
    {
      sql: `INSERT OR IGNORE INTO channels
              (id, workspace_id, tenant_id, name, slug, type, created_by)
            VALUES (?, ?, ?, 'Meet Chat', 'meet-chat', ?, ?)`,
      binds: [chId, workspaceId, tId, MEET_CHAT_CHANNEL_TYPE, by],
    },
    {
      sql: `INSERT OR IGNORE INTO channels
              (id, workspace_id, tenant_id, name, slug, type)
            VALUES (?, ?, ?, 'Meet Chat', 'meet-chat', ?)`,
      binds: [chId, workspaceId, tId, MEET_CHAT_CHANNEL_TYPE],
    },
    {
      sql: `INSERT OR IGNORE INTO channels
              (workspace_id, tenant_id, name, slug, type)
            VALUES (?, ?, 'Meet Chat', 'meet-chat', ?)`,
      binds: [workspaceId, tId, MEET_CHAT_CHANNEL_TYPE],
    },
  ];

  for (const q of inserts) {
    try {
      await db.prepare(q.sql).bind(...q.binds).run();
      break;
    } catch { /* keep trying */ }
  }

  // Re-select after insert attempts
  try {
    const row = await db.prepare(
      "SELECT id FROM channels WHERE workspace_id=? AND slug='meet-chat' LIMIT 1"
    ).bind(workspaceId).first();
    return row?.id ?? null;
  } catch {
    return null;
  }
}

async function upsertParticipant(db, { roomId, userId, displayName, sessionId, tracksJson }) {
  await db.prepare(`
    INSERT INTO meet_participants (room_id, user_id, display_name, session_id, tracks_json, joined_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(room_id, user_id) DO UPDATE SET
      session_id   = excluded.session_id,
      tracks_json  = excluded.tracks_json,
      display_name = excluded.display_name,
      last_seen_at = datetime('now')
  `).bind(roomId, userId, displayName, sessionId, tracksJson || '[]').run();
}

async function pruneStale(db, roomId) {
  await db.prepare(`
    DELETE FROM meet_participants
    WHERE room_id = ? AND last_seen_at < datetime('now', '-15 seconds')
  `).bind(roomId).run();
}

export async function handleMeetApi(request, env, ctx) {
  const url    = new URL(request.url);
  const parts  = url.pathname.replace('/api/meet', '').split('/').filter(Boolean);
  const method = request.method;

  if (parts[0] === 'turn' && method === 'POST')
    return handleTurn(request, env);

  // POST /api/meet/rooms
  if (parts[0] === 'rooms' && !parts[1] && method === 'POST')
    return handleMeetRoomsCreate(request, env);

  if (parts[0] === 'room' && !parts[1] && method === 'POST')
    return handleRoomJoin(request, env);

  if (parts[0] === 'room' && parts[1] && !parts[2] && method === 'GET')
    return handleRoomPoll(request, env, parts[1]);

  if (parts[0] === 'room' && parts[2] === 'session' && method === 'POST')
    return handleSession(request, env, parts[1]);

  if (parts[0] === 'room' && parts[2] === 'publish' && method === 'POST')
    return handlePublish(request, env, parts[1]);

  if (parts[0] === 'room' && parts[2] === 'subscribe' && method === 'POST')
    return handleSubscribe(request, env, parts[1]);

  if (parts[0] === 'room' && parts[2] === 'renegotiate' && method === 'POST')
    return handleRenegotiate(request, env, parts[1]);

  if (parts[0] === 'room' && parts[2] === 'heartbeat' && method === 'POST')
    return handleHeartbeat(request, env, parts[1]);

  if (parts[0] === 'room' && parts[2] === 'chat' && method === 'POST')
    return handleChat(request, env, parts[1]);

  if (parts[0] === 'room' && parts[2] === 'leave' && method === 'POST')
    return handleLeave(request, env, parts[1]);

  if (parts[0] === 'room' && parts[2] === 'invite' && method === 'POST')
    return handleInvite(request, env, parts[1]);

  if (parts[0] === 'recording' && parts[1] === 'save' && method === 'POST')
    return handleRecordingSave(request, env);

  // POST /api/meet/schedule
  if (parts[0] === 'schedule' && method === 'POST')
    return handleSchedule(request, env);

  return jsonResponse({ error: 'Not found' }, 404);
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleMeetRoomsCreate(request, env) {
  const { user, userId } = await getUserId(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? 'Meeting').trim() || 'Meeting';
  const roomId = body.roomId ? String(body.roomId).trim() : genRoomId();
  const forLater = body.scheduled === true || body.forLater === true;
  const workspaceId = resolveWorkspaceIdLoose(user, env, body, url);
  const tenantId = resolveTenantIdLoose(user);

  await insertMeetRoomRow(env, {
    roomId,
    title: name,
    userId,
    workspaceId,
    tenantId,
    status: forLater ? 'scheduled' : 'active',
  });

  return jsonResponse({
    ok: true,
    room: { id: roomId, name },
    joinUrl: meetJoinUrl(env, roomId, request),
    engine: forLater ? 'scheduled' : 'active',
  }, 200);
}

async function handleTurn(request, env) {
  try {
    const tokenParts = (env.REALTIME_TURN_API_TOKEN || '').split(':');
    const keyId      = tokenParts[0];
    const keyToken   = tokenParts.slice(1).join(':');

    if (!keyId || !keyToken) {
      return jsonResponse({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }, 200);
    }

    // Correct CF endpoint: generate-ice-servers (not generate)
    const res = await fetch(`${TURN_BASE}/${keyId}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${keyToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ ttl: 86400 }),
    });

    if (!res.ok) {
      return jsonResponse({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }, 200);
    }

    const data = await res.json();
    // CF returns { iceServers: [...] } directly
    return jsonResponse({ iceServers: data.iceServers }, 200);
  } catch {
    return jsonResponse({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] }, 200);
  }
}

async function handleRoomJoin(request, env) {
  const url    = new URL(request.url);
  const body   = await request.json().catch(() => ({}));
  const roomId = body.roomId || crypto.randomUUID();
  const name   = body.name   || `Meeting ${new Date().toLocaleTimeString()}`;
  const { user, userId } = await getUserId(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!roomId) return jsonResponse({ error: 'Missing required fields' }, 400);

  const workspaceId = resolveWorkspaceIdLoose(user, env, body, url);
  const tenantId = resolveTenantIdLoose(user);
  const cfAppId = env?.CLOUDFLARE_CALLS_APP_ID ?? null;

  await env.DB.prepare(`
    INSERT INTO meet_rooms (id, name, workspace_id, tenant_id, cf_app_id, created_by, created_at, status)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 'active')
    ON CONFLICT(id) DO NOTHING
  `).bind(roomId, name, workspaceId, tenantId, cfAppId, userId).run();

  return jsonResponse({ roomId, name }, 200);
}

async function handleRoomPoll(request, env, roomId) {
  const { userId } = await getUserId(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);
  const db = env.DB;
  await ensureMeetMessagesTable(db);
  await pruneStale(db, roomId);

  const [participants, messages, room] = await Promise.all([
    db.prepare(`
      SELECT user_id, display_name, session_id, tracks_json, joined_at
      FROM meet_participants WHERE room_id = ?
    `).bind(roomId).all(),
    db.prepare(`
      SELECT id, user_id, display_name, content, created_at
      FROM meet_messages WHERE room_id = ? ORDER BY created_at ASC
    `).bind(roomId).all(),
    db.prepare(`SELECT id, name, created_by FROM meet_rooms WHERE id = ?`).bind(roomId).first(),
  ]);

  if (!room) return jsonResponse({ error: 'Not found' }, 404);

  return jsonResponse({
    room,
    participants: (participants.results || []).map(p => ({
      ...p, tracks: JSON.parse(p.tracks_json || '[]'),
    })),
    messages: (messages.results || []).map((m) => ({
      ...m,
      created_at: m?.created_at ? new Date(`${String(m.created_at).replace(' ', 'T')}Z`).toISOString() : null,
    })),
  }, 200);
}

async function handleSession(request, env, roomId) {
  const { user, userId } = await getUserId(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);
  const body = await request.json().catch(() => ({}));
  let data;
  try {
    data = await callsRequest(env, '/sessions/new', 'POST');
  } catch (e) {
    const msg = e?.message != null ? String(e.message) : 'Cloudflare Calls session failed';
    console.warn('[meet] sessions/new', msg);
    return jsonResponse(
      {
        error:
          'Could not start realtime session. Verify Cloudflare Calls app credentials are set on the worker.',
        detail: msg.slice(0, 400),
      },
      503,
    );
  }

  await upsertParticipant(env.DB, {
    roomId,
    userId,
    displayName: body.displayName || user?.email || userId,
    sessionId:   data.sessionId,
    tracksJson:  '[]',
  });

  return jsonResponse({ sessionId: data.sessionId }, 200);
}

async function handlePublish(request, env, roomId) {
  const { userId } = await getUserId(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);
  const body = await request.json();
  const { sessionId, offer, tracks } = body;
  if (!sessionId || !offer || !tracks?.length) return jsonResponse({ error: 'sessionId, offer, tracks required' }, 400);

  const data = await callsRequest(env, `/sessions/${sessionId}/tracks/new`, 'POST', {
    sessionDescription: offer, tracks,
  });

  const trackNames = tracks.map(t => t.trackName);
  await env.DB.prepare(`
    UPDATE meet_participants SET tracks_json = ?, last_seen_at = datetime('now')
    WHERE room_id = ? AND user_id = ?
  `).bind(JSON.stringify(trackNames), roomId, userId).run();

  return jsonResponse({ answer: data.sessionDescription, trackList: data.tracks }, 200);
}

async function handleSubscribe(request, env, roomId) {
  const { userId } = await getUserId(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);
  const body = await request.json();
  const { sessionId, remoteTracks } = body;
  if (!sessionId || !remoteTracks?.length) return jsonResponse({ error: 'sessionId and remoteTracks required' }, 400);

  const data = await callsRequest(env, `/sessions/${sessionId}/tracks/new`, 'POST', {
    tracks: remoteTracks.map(t => ({
      location:  'remote',
      sessionId: t.sessionId,
      trackName: t.trackName,
    })),
  });

  if (data.requiresImmediateRenegotiation) {
    return jsonResponse({ requiresRenegotiation: true, tracks: data.tracks }, 200);
  }
  return jsonResponse({ answer: data.sessionDescription, tracks: data.tracks }, 200);
}

async function handleRenegotiate(request, env, roomId) {
  const { userId } = await getUserId(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);
  const body = await request.json();
  const { sessionId, offer } = body;
  if (!sessionId || !offer) return jsonResponse({ error: 'sessionId and offer required' }, 400);

  const data = await callsRequest(env, `/sessions/${sessionId}/renegotiate`, 'PUT', {
    sessionDescription: offer,
  });
  return jsonResponse({ answer: data.sessionDescription }, 200);
}

async function handleHeartbeat(request, env, roomId) {
  const { userId } = await getUserId(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);
  await env.DB.prepare(`
    UPDATE meet_participants SET last_seen_at = datetime('now')
    WHERE room_id = ? AND user_id = ?
  `).bind(roomId, userId).run();
  return jsonResponse({ ok: true }, 200);
}

async function handleChat(request, env, roomId) {
  const { user, userId } = await getUserId(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);
  const body    = await request.json().catch(() => ({}));
  const content = (body.content || '').trim().slice(0, 2000);
  if (!content) return jsonResponse({ error: 'content required' }, 400);
  await ensureMeetMessagesTable(env.DB);

  const participant = await env.DB.prepare(`
    SELECT display_name FROM meet_participants WHERE room_id = ? AND user_id = ?
  `).bind(roomId, userId).first();

  const displayName = participant?.display_name || user?.email || userId;

  const msgId = crypto.randomUUID();

  // Resolve room workspace/tenant for channel routing + persistence.
  let wsId = null;
  let tenantId = null;
  try {
    const room = await env.DB.prepare(
      `SELECT workspace_id, tenant_id FROM meet_rooms WHERE id = ? LIMIT 1`
    ).bind(roomId).first();
    wsId = room?.workspace_id ?? null;
    tenantId = room?.tenant_id ?? null;
  } catch { /* ignore */ }

  await env.DB.prepare(`
    INSERT INTO meet_messages (id, room_id, workspace_id, user_id, display_name, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(msgId, roomId, wsId, userId, displayName, content).run();

  // Dual-write to persistent messages table (best-effort).
  try {
    const chId = await ensureMeetChatChannelId(env.DB, env, { workspaceId: wsId, tenantId, createdBy: userId });
    if (chId) {
      const persistentId = newId('msg');
      await env.DB.prepare(`
        INSERT INTO messages
          (id, channel_id, workspace_id, tenant_id, user_id,
           content, content_type, metadata_json, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,unixepoch(),unixepoch())
      `).bind(
        persistentId,
        chId,
        wsId,
        tenantId,
        userId,
        content,
        'text',
        JSON.stringify({ room_id: roomId, source: 'meet_chat', meet_message_id: msgId })
      ).run();

      await env.DB.prepare(`UPDATE meet_messages SET channel_id = ? WHERE id = ?`)
        .bind(chId, msgId).run().catch(() => {});
    }
  } catch { /* ignore */ }

  return jsonResponse({ ok: true }, 200);
}

async function handleLeave(request, env, roomId) {
  const { userId } = await getUserId(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);
  await env.DB.prepare(`
    DELETE FROM meet_participants WHERE room_id = ? AND user_id = ?
  `).bind(roomId, userId).run();

  const { count } = await env.DB.prepare(`
    SELECT COUNT(*) as count FROM meet_participants WHERE room_id = ?
  `).bind(roomId).first();

  if (count === 0) {
    await env.DB.prepare(`
      UPDATE meet_rooms SET
        ended_at = datetime('now'),
        duration_sec = (unixepoch() - unixepoch(created_at)),
        status = 'ended'
      WHERE id = ?
    `).bind(roomId).run();
  }
  return jsonResponse({ ok: true }, 200);
}

async function handleInvite(request, env, roomId) {
  const { user, userId } = await getUserId(request, env);
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);

  const access = await assertCanInviteToRoom(env.DB, roomId, userId, user);
  if (!access.ok) {
    return jsonResponse({ error: access.error }, access.status ?? 403);
  }

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const linkRaw = String(body.link || '').trim();
  const link = linkRaw || meetJoinUrl(env, roomId, request);

  if (!isValidInviteEmail(email)) {
    return jsonResponse({ error: 'invalid_email' }, 400);
  }
  if (!validateMeetInviteLink(link, env, roomId, request)) {
    return jsonResponse({ error: 'invalid_link_for_room' }, 400);
  }

  const meetingName = access.room?.name || 'a meeting';
  const inviterLabel = user?.email || user?.name || userId;
  const workspaceId = access.room?.workspace_id ?? resolveWorkspaceIdLoose(user, env, body, new URL(request.url));
  const tenantId = resolveTenantIdLoose(user);

  const { sent, failed, results } = await sendMeetInvites(env, {
    roomId,
    emails: [email],
    invitedBy: userId,
    workspaceId,
    tenantId,
    meetingName,
    inviterLabel,
    link,
  });

  if (failed > 0) {
    const err = results[0]?.error || 'send_failed';
    if (err === 'RESEND_API_KEY not configured' || err === 'from required (set RESEND_FROM or EMAIL_FROM)') {
      return jsonResponse({ error: err }, 503);
    }
    return jsonResponse({ error: `Resend failed: ${err}` }, 502);
  }

  return jsonResponse({ ok: true, sent, invite: results[0] ?? null }, 200);
}

async function handleRecordingSave(request, env) {
  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  const r2Denied = platformR2WriteGateResponse(authUser);
  if (r2Denied) return r2Denied;

  const form = await request.formData().catch(() => null);
  if (!form) return jsonResponse({ error: 'FormData required' }, 400);
  const file = form.get('recording');
  const roomId = form.get('roomId') || 'unknown';
  if (!file || typeof file === 'string') return jsonResponse({ error: 'recording file required' }, 400);
  const userId = authUser.id || authUser.user_id || authUser.userId;
  if (!userId) return jsonResponse({ error: 'Unauthorized' }, 401);
  const r2Key = `meet/recordings/${userId}/${roomId}_${Date.now()}.webm`;
  await env.ASSETS.put(r2Key, file.stream(), {
    httpMetadata: { contentType: 'video/webm' },
  });
  return jsonResponse({ ok: true, r2_key: r2Key }, 200);
}

async function handleSchedule(request, env) {
  const identity = await resolveIdentity(env, request);
  if (!identity) return jsonResponse({ error: 'unauthenticated' }, 401);
  if (!identity.workspaceId) {
    return jsonResponse({ error: 'no_workspace', redirect: '/onboarding' }, 403);
  }

  const body = await request.json().catch(() => ({}));

  const title = String(body.title || '').trim();
  const scheduled_at = String(body.scheduled_at || body.scheduledAt || '').trim();
  const description = body.description != null ? String(body.description) : '';
  const dur = Number(body.duration_min ?? body.durationMin) || 60;
  const invite_emails = normalizeInviteEmails(
    Array.isArray(body.invite_emails)
      ? body.invite_emails
      : Array.isArray(body.inviteEmails)
        ? body.inviteEmails
        : [],
  );

  if (!title || !scheduled_at) return jsonResponse({ error: 'Title and date required' }, 400);

  const startMs = new Date(scheduled_at).getTime();
  if (!Number.isFinite(startMs)) {
    return jsonResponse({ error: 'invalid_scheduled_at' }, 400);
  }

  const tenant_id = identity.tenantId;
  const workspace_id = identity.workspaceId;
  const userId = identity.userId;

  const roomId = genRoomId();
  const schedId = `msched_${roomId}`;
  const calId = newId('cev');

  await insertMeetRoomRow(env, {
    roomId,
    title,
    userId,
    workspaceId: workspace_id,
    tenantId: tenant_id,
    calendarEventId: calId,
    status: 'scheduled',
  });

  await env.DB.prepare(
    `INSERT INTO meet_scheduled
       (id, room_id, created_by, title, description, scheduled_at, duration_min, invite_emails, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
  )
    .bind(
      schedId,
      roomId,
      userId,
      title,
      description || null,
      scheduled_at,
      dur,
      JSON.stringify(invite_emails),
    )
    .run();

  const endISO = new Date(startMs + dur * 60000).toISOString();

  await env.DB.prepare(
    `INSERT INTO calendar_events
       (id, tenant_id, workspace_id, user_id, title, event_type,
        start_datetime, end_datetime, timezone, attendees, meet_room_id, status)
     VALUES (?, ?, ?, ?, ?, 'meeting', ?, ?, 'America/Chicago', ?, ?, 'scheduled')`,
  )
    .bind(
      calId,
      tenant_id,
      workspace_id,
      userId,
      title,
      scheduled_at,
      endISO,
      JSON.stringify(invite_emails),
      roomId,
    )
    .run();

  const joinUrl = meetJoinUrl(env, roomId, request);
  const scheduledLabel = formatMeetScheduleLabel(scheduled_at, dur);
  const inviterLabel = identity.email || identity.userId || userId;

  let inviteSummary = { sent: 0, failed: 0 };
  if (invite_emails.length > 0) {
    inviteSummary = await sendMeetInvites(env, {
      roomId,
      emails: invite_emails,
      invitedBy: userId,
      workspaceId: workspace_id,
      tenantId: tenant_id,
      scheduledId: schedId,
      calendarEventId: calId,
      meetingName: title,
      inviterLabel,
      link: joinUrl,
      scheduledLabel,
      description: description || null,
    });
  }

  return jsonResponse({
    ok: true,
    room_id: roomId,
    scheduled_id: schedId,
    calendar_event_id: calId,
    join_url: joinUrl,
    invites: inviteSummary,
  }, 200);
}
