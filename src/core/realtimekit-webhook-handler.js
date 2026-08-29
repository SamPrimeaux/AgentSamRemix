/**
 * RealtimeKit webhook event → D1 meet_rooms lifecycle updates.
 */

function newEventId() {
  return `mwe_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function parseIsoMs(iso) {
  if (!iso) return null;
  const ms = Date.parse(String(iso));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {object} env
 * @param {string} rtkMeetingId
 */
async function findRoomByRtkMeetingId(env, rtkMeetingId) {
  return env.DB.prepare(
    `SELECT id, status, participant_count, started_at, created_at
     FROM meet_rooms WHERE realtimekit_meeting_id = ? LIMIT 1`,
  )
    .bind(rtkMeetingId)
    .first();
}

async function ensureMeetWebhookEventsTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS meet_webhook_events (
      id TEXT PRIMARY KEY,
      dyte_uuid TEXT UNIQUE,
      event_type TEXT NOT NULL,
      meeting_id TEXT,
      room_id TEXT,
      payload_json TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();
}

/**
 * @param {object} env
 * @param {{ dyteUuid?: string|null, eventType: string, meetingId?: string|null, roomId?: string|null, payload: unknown }} row
 */
async function recordMeetWebhookEvent(env, row) {
  await ensureMeetWebhookEventsTable(env.DB);
  if (row.dyteUuid) {
    const existing = await env.DB.prepare(
      `SELECT id FROM meet_webhook_events WHERE dyte_uuid = ? LIMIT 1`,
    )
      .bind(row.dyteUuid)
      .first();
    if (existing?.id) return { duplicate: true, id: existing.id };
  }
  const id = newEventId();
  await env.DB.prepare(
    `INSERT INTO meet_webhook_events (id, dyte_uuid, event_type, meeting_id, room_id, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      row.dyteUuid ?? null,
      row.eventType,
      row.meetingId ?? null,
      row.roomId ?? null,
      JSON.stringify(row.payload ?? {}).slice(0, 12000),
    )
    .run();
  return { duplicate: false, id };
}

/**
 * @param {object} env
 * @param {string} eventType
 * @param {Record<string, unknown>} payload
 */
export async function applyRealtimeKitWebhookToD1(env, eventType, payload) {
  const meeting = /** @type {Record<string, unknown>|undefined} */ (payload?.meeting);
  const meetingId =
    (meeting?.id != null ? String(meeting.id) : null) ||
    (payload?.meetingId != null ? String(payload.meetingId) : null);

  if (!meetingId) {
    return { ok: true, applied: false, reason: 'no_meeting_id' };
  }

  const room = await findRoomByRtkMeetingId(env, meetingId);
  if (!room?.id) {
    return { ok: true, applied: false, reason: 'room_not_found', meetingId };
  }

  const roomId = String(room.id);
  let participantDelta = 0;

  if (eventType === 'meeting.started') {
    const sessionId = meeting?.sessionId != null ? String(meeting.sessionId) : null;
    const startedAt = meeting?.startedAt != null ? String(meeting.startedAt) : null;
    await env.DB.prepare(
      `UPDATE meet_rooms SET
         status = 'active',
         rtk_session_id = COALESCE(?, rtk_session_id),
         started_at = COALESCE(?, started_at),
         last_webhook_event = ?,
         last_webhook_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(sessionId, startedAt, eventType, roomId)
      .run();
    return { ok: true, applied: true, roomId, eventType };
  }

  if (eventType === 'meeting.ended') {
    const endedAt = meeting?.endedAt != null ? String(meeting.endedAt) : new Date().toISOString();
    const startedMs =
      parseIsoMs(meeting?.startedAt) ||
      parseIsoMs(room.started_at) ||
      parseIsoMs(room.created_at);
    const endedMs = parseIsoMs(endedAt);
    let durationSec = null;
    if (startedMs != null && endedMs != null && endedMs >= startedMs) {
      durationSec = Math.round((endedMs - startedMs) / 1000);
    }
    await env.DB.prepare(
      `UPDATE meet_rooms SET
         status = 'ended',
         ended_at = ?,
         duration_sec = COALESCE(?, duration_sec),
         last_webhook_event = ?,
         last_webhook_at = datetime('now')
       WHERE id = ?`,
    )
      .bind(endedAt, durationSec, eventType, roomId)
      .run();

    await env.DB.prepare(
      `UPDATE meet_scheduled SET status = 'completed' WHERE room_id = ? AND status = 'scheduled'`,
    )
      .bind(roomId)
      .run()
      .catch(() => {});

    await env.DB.prepare(
      `UPDATE calendar_events SET status = 'completed', updated_at = datetime('now')
       WHERE meet_room_id = ? AND status = 'scheduled'`,
    )
      .bind(roomId)
      .run()
      .catch(() => {});

    return { ok: true, applied: true, roomId, eventType, durationSec };
  }

  if (eventType === 'meeting.participantJoined') {
    participantDelta = 1;
  } else if (eventType === 'meeting.participantLeft') {
    participantDelta = -1;
  } else {
    await env.DB.prepare(
      `UPDATE meet_rooms SET last_webhook_event = ?, last_webhook_at = datetime('now') WHERE id = ?`,
    )
      .bind(eventType, roomId)
      .run();
    return { ok: true, applied: true, roomId, eventType, note: 'metadata_only' };
  }

  const current = Number(room.participant_count) || 0;
  const next = Math.max(0, current + participantDelta);
  await env.DB.prepare(
    `UPDATE meet_rooms SET
       participant_count = ?,
       last_webhook_event = ?,
       last_webhook_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(next, eventType, roomId)
    .run();

  return { ok: true, applied: true, roomId, eventType, participant_count: next };
}

/**
 * @param {object} env
 * @param {Record<string, unknown>} payload
 * @param {string|null} dyteUuid
 */
export async function processRealtimeKitWebhookPayload(env, payload, dyteUuid = null) {
  const eventType = String(payload?.event || payload?.type || 'unknown').trim();
  const meeting = payload?.meeting;
  const meetingId =
    meeting && typeof meeting === 'object' && meeting !== null && 'id' in meeting
      ? String(/** @type {{ id?: string }} */ (meeting).id)
      : payload?.meetingId != null
        ? String(payload.meetingId)
        : null;

  const dedupe = await recordMeetWebhookEvent(env, {
    dyteUuid,
    eventType,
    meetingId,
    roomId: null,
    payload,
  });
  if (dedupe.duplicate) {
    return { ok: true, duplicate: true, eventId: dedupe.id };
  }

  const applied = await applyRealtimeKitWebhookToD1(env, eventType, payload);

  if (meetingId && applied.roomId) {
    await env.DB.prepare(
      `UPDATE meet_webhook_events SET room_id = ? WHERE id = ?`,
    )
      .bind(applied.roomId, dedupe.id)
      .run()
      .catch(() => {});
  }

  return { ok: true, duplicate: false, eventId: dedupe.id, ...applied };
}
