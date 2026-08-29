/**
 * Shared Meet helpers — invites, scheduled rooms, Resend (IAM setup).
 */

import { sendResendEmail } from '../../backend/services/email/resend.js';
import { isMeetEngineRealtimeKit } from './realtimekit-client.js';

const MEET_JOIN_PATH = '/dashboard/meet';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export function meetPublicBaseUrl(env, request = null) {
  const fromEnv =
    (env?.PUBLIC_APP_URL && String(env.PUBLIC_APP_URL).trim()) ||
    (env?.APP_URL && String(env.APP_URL).trim()) ||
    '';
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (request) {
    try {
      const url = new URL(request.url);
      return `${url.protocol}//${url.host}`;
    } catch {
      /* fall through */
    }
  }
  return 'https://inneranimalmedia.com';
}

export function meetJoinUrl(env, roomId, request = null) {
  return `${meetPublicBaseUrl(env, request)}${MEET_JOIN_PATH}?room=${encodeURIComponent(String(roomId))}`;
}

export function isValidInviteEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || e.length > 254) return false;
  return EMAIL_RE.test(e);
}

export function normalizeInviteEmails(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const e = String(item || '').trim().toLowerCase();
    if (!isValidInviteEmail(e) || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

export function validateMeetInviteLink(link, env, roomId, request = null) {
  const rid = String(roomId || '').trim();
  if (!rid) return false;
  try {
    const u = new URL(String(link || '').trim());
    const expected = new URL(meetJoinUrl(env, rid, request));
    if (u.host !== expected.host) return false;
    return u.searchParams.get('room') === rid;
  } catch {
    return false;
  }
}

export function newMeetInviteId() {
  return `minv_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export async function ensureMeetInvitesTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS meet_invites (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      email TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      workspace_id TEXT,
      tenant_id TEXT,
      scheduled_id TEXT,
      calendar_event_id TEXT,
      resend_id TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(room_id, email)
    )
  `).run();
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function meetInviteHtml({ meetingName, inviterLabel, link, scheduledLabel, description }) {
  const safeTitle = escapeHtml(meetingName);
  const safeInviter = escapeHtml(inviterLabel);
  const safeLink = escapeHtml(link);
  const safeWhen = scheduledLabel ? escapeHtml(scheduledLabel) : '';
  const safeDesc = description ? escapeHtml(description) : '';
  return `
    <div style="font-family:monospace;background:#07100f;color:#c9d8d6;padding:32px;border-radius:12px;max-width:520px">
      <div style="color:#2dd4bf;font-weight:700;font-size:16px;margin-bottom:8px">Inner Animal Media</div>
      <h2 style="color:#e2efed;margin:0 0 12px">You're invited to a meeting</h2>
      <p style="color:#6b9e99">${safeInviter} invited you to <strong style="color:#c9d8d6">${safeTitle}</strong>.</p>
      ${safeWhen ? `<p style="color:#6b9e99">When: ${safeWhen}</p>` : ''}
      ${safeDesc ? `<p style="color:#6b9e99">${safeDesc}</p>` : ''}
      <a href="${safeLink}" style="display:inline-block;background:#2dd4bf;color:#07100f;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:700;margin-top:12px">Join meeting</a>
      <p style="color:#4a7a75;font-size:11px;margin-top:16px">Or copy this link: ${safeLink}</p>
    </div>
  `;
}

export async function recordMeetInvite(db, row) {
  await ensureMeetInvitesTable(db);
  await db.prepare(
    `INSERT INTO meet_invites (
      id, room_id, email, invited_by, workspace_id, tenant_id,
      scheduled_id, calendar_event_id, resend_id, status, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(room_id, email) DO UPDATE SET
      invited_by = excluded.invited_by,
      resend_id = COALESCE(excluded.resend_id, meet_invites.resend_id),
      status = excluded.status,
      error_message = excluded.error_message,
      scheduled_id = COALESCE(excluded.scheduled_id, meet_invites.scheduled_id),
      calendar_event_id = COALESCE(excluded.calendar_event_id, meet_invites.calendar_event_id)`,
  )
    .bind(
      row.id,
      row.roomId,
      row.email,
      row.invitedBy,
      row.workspaceId ?? null,
      row.tenantId ?? null,
      row.scheduledId ?? null,
      row.calendarEventId ?? null,
      row.resendId ?? null,
      row.status ?? 'sent',
      row.errorMessage ?? null,
    )
    .run();
}

export async function sendMeetInviteEmail(env, opts) {
  const meetingName = String(opts.meetingName || 'a meeting').trim() || 'a meeting';
  const inviterLabel = String(opts.inviterLabel || 'Someone').trim() || 'Someone';
  const link = String(opts.link || '').trim();
  const to = String(opts.to || '').trim().toLowerCase();
  if (!isValidInviteEmail(to)) return { error: 'invalid_email' };
  if (!link) return { error: 'link_required' };

  const subject = opts.scheduledLabel
    ? `You're invited: ${meetingName}`
    : `You've been invited to ${meetingName}`;

  return sendResendEmail(env, {
    to,
    subject: subject.slice(0, 998),
    html: meetInviteHtml({
      meetingName,
      inviterLabel,
      link,
      scheduledLabel: opts.scheduledLabel ?? null,
      description: opts.description ?? null,
    }),
    tags: [{ name: 'source', value: 'meet_invite' }],
  });
}

/**
 * Send invites + persist meet_invites rows (Resend via IAM Worker secret).
 * @returns {{ sent: number, failed: number, results: Array<{ email: string, ok: boolean, error?: string }> }}
 */
export async function sendMeetInvites(env, opts) {
  const emails = normalizeInviteEmails(opts.emails);
  const results = [];
  let sent = 0;
  let failed = 0;

  if (!emails.length) return { sent, failed, results };

  for (const email of emails) {
    const inviteId = newMeetInviteId();
    const sendResult = await sendMeetInviteEmail(env, {
      to: email,
      meetingName: opts.meetingName,
      inviterLabel: opts.inviterLabel,
      link: opts.link,
      scheduledLabel: opts.scheduledLabel ?? null,
      description: opts.description ?? null,
    });

    const ok = !sendResult.error;
    if (ok) sent += 1;
    else failed += 1;

    await recordMeetInvite(env.DB, {
      id: inviteId,
      roomId: opts.roomId,
      email,
      invitedBy: opts.invitedBy,
      workspaceId: opts.workspaceId ?? null,
      tenantId: opts.tenantId ?? null,
      scheduledId: opts.scheduledId ?? null,
      calendarEventId: opts.calendarEventId ?? null,
      resendId: sendResult.id ?? null,
      status: ok ? 'sent' : 'failed',
      errorMessage: sendResult.error ?? null,
    }).catch(() => {});

    results.push({ email, ok, error: sendResult.error ?? undefined });
  }

  return { sent, failed, results };
}

export async function assertCanInviteToRoom(db, roomId, userId, user) {
  const room = await db.prepare(
    `SELECT id, name, created_by, workspace_id, status FROM meet_rooms WHERE id = ? LIMIT 1`,
  )
    .bind(roomId)
    .first();
  if (!room) return { ok: false, error: 'room_not_found', status: 404, room: null };
  if (String(room.created_by) === String(userId)) {
    return { ok: true, room };
  }
  const ws = user?.workspace_id ?? user?.workspaceId ?? null;
  if (ws && room.workspace_id && String(ws) === String(room.workspace_id)) {
    return { ok: true, room };
  }
  return { ok: false, error: 'forbidden', status: 403, room: null };
}

/**
 * Insert meet_rooms row for scheduled or ad-hoc link (RTK meeting created lazily on token).
 */
export async function insertMeetRoomRow(env, {
  roomId,
  title,
  userId,
  workspaceId,
  tenantId,
  calendarEventId = null,
  status = 'scheduled',
  hostPreset = 'group_call_host',
}) {
  const engine = isMeetEngineRealtimeKit(env) ? 'realtimekit' : 'legacy';
  const cfAppId =
    engine === 'realtimekit'
      ? (env?.REALTIMEKIT_APP_ID != null ? String(env.REALTIMEKIT_APP_ID).trim() : null)
      : (env?.CLOUDFLARE_CALLS_APP_ID != null ? String(env.CLOUDFLARE_CALLS_APP_ID).trim() : null);

  await env.DB.prepare(
    `INSERT INTO meet_rooms (
      id, name, created_by, status, workspace_id, tenant_id,
      calendar_event_id, cf_app_id, engine, realtimekit_host_preset
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      workspace_id = COALESCE(excluded.workspace_id, meet_rooms.workspace_id),
      tenant_id = COALESCE(excluded.tenant_id, meet_rooms.tenant_id),
      calendar_event_id = COALESCE(excluded.calendar_event_id, meet_rooms.calendar_event_id),
      cf_app_id = COALESCE(excluded.cf_app_id, meet_rooms.cf_app_id),
      engine = excluded.engine,
      realtimekit_host_preset = COALESCE(excluded.realtimekit_host_preset, meet_rooms.realtimekit_host_preset),
      status = excluded.status`,
  )
    .bind(
      roomId,
      title,
      userId,
      status,
      workspaceId,
      tenantId,
      calendarEventId,
      cfAppId,
      engine,
      engine === 'realtimekit' ? hostPreset : null,
    )
    .run();

  return { roomId, engine };
}

export function formatMeetScheduleLabel(scheduledAt, durationMin, timezone = 'America/Chicago') {
  try {
    const dateStr = new Date(scheduledAt).toLocaleString('en-US', {
      timeZone: timezone,
      dateStyle: 'full',
      timeStyle: 'short',
    });
    return `${dateStr} (${durationMin} minutes)`;
  } catch {
    return `${scheduledAt} (${durationMin} minutes)`;
  }
}
