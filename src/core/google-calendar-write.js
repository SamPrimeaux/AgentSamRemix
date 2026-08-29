/**
 * Google Calendar write-back — OAuth token, scope gate, IAM ↔ Google event mapping.
 */

import { getIntegrationOAuthRow } from '../../backend/identity/oauth/user-token.js';
import {
  deleteCalendarEventV3,
  insertCalendarEventV3,
  patchCalendarEventV3,
} from '../integrations/google-calendar-v3-ops.js';
import { GOOGLE_CALENDAR_PROVIDER } from './google-calendar-user-tokens.js';

export const GOOGLE_CALENDAR_WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
export const GOOGLE_CALENDAR_PRIMARY = 'primary';

/** @param {string|null|undefined} scope */
export function hasGoogleCalendarWriteScope(scope) {
  const s = String(scope || '').toLowerCase();
  if (!s) return false;
  if (s.includes('calendar.events.readonly')) return false;
  if (s.includes('calendar.readonly') && !s.includes('calendar.events')) return false;
  return (
    s.includes('calendar.events') ||
    s.includes('/auth/calendar') && !s.includes('.readonly')
  );
}

/** @param {string|null|undefined} sqlDt */
function sqlDateOnly(sqlDt) {
  const raw = String(sqlDt || '').trim();
  if (!raw) return null;
  return raw.slice(0, 10);
}

/** @param {string|null|undefined} sqlDt */
function sqlToRfc3339Local(sqlDt) {
  const raw = String(sqlDt || '').trim();
  if (!raw) return null;
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(iso)) return iso;
  return iso.length === 16 ? `${iso}:00` : iso;
}

/** Google all-day end date is exclusive. */
function googleAllDayEndExclusive(endSql) {
  const endDate = sqlDateOnly(endSql);
  if (!endDate) return null;
  const d = new Date(`${endDate}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * @param {{
 *   title?: string|null,
 *   description?: string|null,
 *   location?: string|null,
 *   start_datetime?: string|null,
 *   end_datetime?: string|null,
 *   all_day?: number|boolean|null,
 *   timezone?: string|null,
 *   attendees?: string|null,
 * }} row
 */
export function iamEventToGoogleResource(row) {
  const title = String(row.title || '(No title)').trim().slice(0, 200);
  const description = row.description != null ? String(row.description).slice(0, 8000) : undefined;
  const location = row.location != null ? String(row.location).slice(0, 400) : undefined;
  const allDay = row.all_day === 1 || row.all_day === true;
  const tz = String(row.timezone || 'UTC').trim() || 'UTC';

  let start;
  let end;
  if (allDay) {
    const startDate = sqlDateOnly(row.start_datetime);
    const endDate = googleAllDayEndExclusive(row.end_datetime) || startDate;
    start = { date: startDate };
    end = { date: endDate };
  } else {
    start = { dateTime: sqlToRfc3339Local(row.start_datetime), timeZone: tz };
    end = { dateTime: sqlToRfc3339Local(row.end_datetime), timeZone: tz };
  }

  const resource = { summary: title, start, end };
  if (description) resource.description = description;
  if (location) resource.location = location;

  let emails = [];
  try {
    const parsed = typeof row.attendees === 'string' ? JSON.parse(row.attendees) : row.attendees;
    if (Array.isArray(parsed)) {
      emails = parsed.map((a) => String(a?.email || a || '').trim()).filter(Boolean);
    }
  } catch {
    emails = [];
  }
  if (emails.length) {
    resource.attendees = emails.map((email) => ({ email }));
  }

  return resource;
}

/**
 * @param {*} env
 * @param {string} userId
 * @param {string} [account]
 */
export async function getGoogleCalendarWriteToken(env, userId, account = '') {
  const acct = String(account || '').trim().toLowerCase();
  const row = await getIntegrationOAuthRow(env, userId, GOOGLE_CALENDAR_PROVIDER, acct);
  if (!row?.access_token) {
    return { ok: false, error: 'google_calendar_not_connected', needs_reconnect: true };
  }
  if (!hasGoogleCalendarWriteScope(row.scope)) {
    return {
      ok: false,
      error: 'google_calendar_write_scope_required',
      needs_reconnect: true,
      connect_url: '/api/integrations/google-calendar/connect?return_to=/dashboard/collaborate',
    };
  }
  return {
    ok: true,
    token: String(row.access_token),
    account: String(row.account_identifier || row.account_email || acct).toLowerCase(),
    scope: row.scope,
  };
}

/**
 * @param {*} env
 * @param {string} userId
 * @param {Record<string, unknown>} eventPayload
 * @param {{ account?: string, calendarId?: string }} [opts]
 */
export async function createGoogleCalendarEvent(env, userId, eventPayload, opts = {}) {
  const auth = await getGoogleCalendarWriteToken(env, userId, opts.account);
  if (!auth.ok) return auth;

  const resource = iamEventToGoogleResource(eventPayload);
  const out = await insertCalendarEventV3(
    auth.token,
    opts.calendarId || GOOGLE_CALENDAR_PRIMARY,
    resource,
  );
  if (!out.ok) {
    return { ok: false, error: out.error || 'google_insert_failed', status: out.status };
  }
  return {
    ok: true,
    google_event: out.data,
    external_event_id: String(out.data?.id || ''),
    sync_account: auth.account,
  };
}

/**
 * @param {*} env
 * @param {string} userId
 * @param {string} externalEventId
 * @param {Record<string, unknown>} eventPayload
 * @param {{ account?: string, calendarId?: string }} [opts]
 */
export async function updateGoogleCalendarEvent(env, userId, externalEventId, eventPayload, opts = {}) {
  const auth = await getGoogleCalendarWriteToken(env, userId, opts.account);
  if (!auth.ok) return auth;

  const eventId = String(externalEventId || '').trim();
  if (!eventId) return { ok: false, error: 'missing_external_event_id' };

  const resource = iamEventToGoogleResource(eventPayload);
  const out = await patchCalendarEventV3(
    auth.token,
    opts.calendarId || GOOGLE_CALENDAR_PRIMARY,
    eventId,
    resource,
  );
  if (!out.ok) {
    return { ok: false, error: out.error || 'google_update_failed', status: out.status };
  }
  return { ok: true, google_event: out.data };
}

/**
 * @param {*} env
 * @param {string} userId
 * @param {string} externalEventId
 * @param {{ account?: string, calendarId?: string }} [opts]
 */
export async function removeGoogleCalendarEvent(env, userId, externalEventId, opts = {}) {
  const auth = await getGoogleCalendarWriteToken(env, userId, opts.account);
  if (!auth.ok) return auth;

  const eventId = String(externalEventId || '').trim();
  if (!eventId) return { ok: false, error: 'missing_external_event_id' };

  const out = await deleteCalendarEventV3(
    auth.token,
    opts.calendarId || GOOGLE_CALENDAR_PRIMARY,
    eventId,
  );
  if (!out.ok && out.status !== 404) {
    return { ok: false, error: out.error || 'google_delete_failed', status: out.status };
  }
  return { ok: true, deleted: true };
}

/** @param {*} env @param {object} authUser @param {string} [preferredAccount] */
export async function resolveDefaultGoogleCalendarAccount(env, authUser, preferredAccount = '') {
  const { listGoogleCalendarTokenRowsForUser } = await import('./google-calendar-user-tokens.js');
  const rows = await listGoogleCalendarTokenRowsForUser(env, authUser);
  if (!rows.length) return null;
  const pref = String(preferredAccount || '').trim().toLowerCase();
  if (pref) {
    const hit = rows.find(
      (r) => String(r.account_identifier || r.account_email || '').toLowerCase() === pref,
    );
    if (hit) return String(hit.account_identifier || hit.account_email).toLowerCase();
  }
  const writable = rows.find((r) => hasGoogleCalendarWriteScope(r.scope));
  const pick = writable || rows[0];
  return String(pick.account_identifier || pick.account_email || '').toLowerCase() || null;
}
