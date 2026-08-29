/**
 * Google Calendar API v3 — events CRUD (primary calendar).
 * @see https://developers.google.com/calendar/api/v3/reference/events
 */

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

async function parseGoogleError(res) {
  const data = await res.json().catch(() => ({}));
  return data?.error?.message || res.statusText || 'Google Calendar request failed';
}

/** @param {string} token @param {string} method @param {string} path @param {{ query?: Record<string, string|boolean|number|null|undefined>, body?: object }} [opts] */
async function calendarApiRequest(token, method, path, opts = {}) {
  const url = new URL(`${CALENDAR_API}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const init = {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  };
  if (opts.body != null) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url.toString(), init);
  if (res.status === 204) return { ok: true, data: null, status: 204 };
  if (res.status === 404) return { ok: false, error: 'not_found', status: 404 };
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error?.message || res.statusText || 'request_failed', status: res.status };
  }
  return { ok: true, data, status: res.status };
}

/** @param {string} token @param {string} calendarId @param {object} resource @param {{ sendUpdates?: string }} [opts] */
export async function insertCalendarEventV3(token, calendarId, resource, opts = {}) {
  return calendarApiRequest(token, 'POST', `/calendars/${encodeURIComponent(calendarId)}/events`, {
    query: { sendUpdates: opts.sendUpdates || 'all' },
    body: resource,
  });
}

/** @param {string} token @param {string} calendarId @param {string} eventId @param {object} resource @param {{ sendUpdates?: string }} [opts] */
export async function patchCalendarEventV3(token, calendarId, eventId, resource, opts = {}) {
  return calendarApiRequest(
    token,
    'PATCH',
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { query: { sendUpdates: opts.sendUpdates || 'all' }, body: resource },
  );
}

/** @param {string} token @param {string} calendarId @param {string} eventId @param {{ sendUpdates?: string }} [opts] */
export async function deleteCalendarEventV3(token, calendarId, eventId, opts = {}) {
  return calendarApiRequest(
    token,
    'DELETE',
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { query: { sendUpdates: opts.sendUpdates || 'all' } },
  );
}

/** @param {string} token @param {string} calendarId @param {string} eventId */
export async function getCalendarEventV3(token, calendarId, eventId) {
  return calendarApiRequest(
    token,
    'GET',
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
}
