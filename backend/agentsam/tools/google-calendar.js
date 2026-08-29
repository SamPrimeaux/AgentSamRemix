/**
 * Google Calendar MCP-style tools for in-app Agent Sam (user OAuth).
 */

import { getIntegrationOAuthRow } from '../../identity/oauth/user-token.js';
import { GOOGLE_CALENDAR_PROVIDER } from '../../../src/core/google-calendar-user-tokens.js';
import {
  createGoogleCalendarEvent,
  removeGoogleCalendarEvent,
  updateGoogleCalendarEvent,
} from '../../../src/core/google-calendar-write.js';

function resolveUserId(params, runContext) {
  return (
    String(params?.user_id || params?.userId || runContext?.userId || runContext?.user_id || '').trim() ||
    null
  );
}

async function listGoogleEvents(env, userId, params) {
  const account = String(params?.account || params?.sync_account || '').trim().toLowerCase();
  const row = await getIntegrationOAuthRow(env, userId, GOOGLE_CALENDAR_PROVIDER, account);
  if (!row?.access_token) return { ok: false, error: 'google_calendar_not_connected' };

  const calendarId = String(params?.calendar_id || 'primary');
  const timeMin = params?.time_min || new Date(Date.now() - 7 * 86400000).toISOString();
  const timeMax = params?.time_max || new Date(Date.now() + 60 * 86400000).toISOString();
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('timeMin', String(timeMin));
  url.searchParams.set('timeMax', String(timeMax));
  url.searchParams.set('maxResults', String(Math.min(Number(params?.limit) || 50, 100)));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${row.access_token}`, Accept: 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
  return { ok: true, events: data.items || [], account: row.account_identifier || row.account_email };
}

export const handlers = {
  async gcal_list(params, env, runContext) {
    const userId = resolveUserId(params, runContext);
    if (!userId) return { ok: false, error: 'user_id required' };
    return listGoogleEvents(env, userId, params || {});
  },

  async gcal_create(params, env, runContext) {
    const userId = resolveUserId(params, runContext);
    if (!userId) return { ok: false, error: 'user_id required' };
    return createGoogleCalendarEvent(env, userId, params || {}, {
      account: params?.account || params?.sync_account,
    });
  },

  async gcal_update(params, env, runContext) {
    const userId = resolveUserId(params, runContext);
    const eventId = String(params?.event_id || params?.eventId || '').trim();
    if (!userId) return { ok: false, error: 'user_id required' };
    if (!eventId) return { ok: false, error: 'event_id required' };
    return updateGoogleCalendarEvent(env, userId, eventId, params || {}, {
      account: params?.account || params?.sync_account,
    });
  },

  async gcal_delete(params, env, runContext) {
    const userId = resolveUserId(params, runContext);
    const eventId = String(params?.event_id || params?.eventId || '').trim();
    if (!userId) return { ok: false, error: 'user_id required' };
    if (!eventId) return { ok: false, error: 'event_id required' };
    return removeGoogleCalendarEvent(env, userId, eventId, {
      account: params?.account || params?.sync_account,
    });
  },
};
