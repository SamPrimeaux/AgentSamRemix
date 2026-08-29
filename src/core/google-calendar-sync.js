/**
 * Google Calendar API ↔ D1 calendar_events (import sync + write-back on CRUD).
 */

import { getIntegrationOAuthRow } from '../../backend/identity/oauth/user-token.js';
import { GOOGLE_CALENDAR_PROVIDER, listAllGoogleCalendarTokenRows } from './google-calendar-user-tokens.js';

function toSqlDateTimeFromIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function googleEventWindow() {
  const from = new Date();
  from.setDate(from.getDate() - 7);
  const to = new Date();
  to.setDate(to.getDate() + 60);
  return {
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
  };
}

function inferEventType(item) {
  const attendees = Array.isArray(item?.attendees) ? item.attendees : [];
  const others = attendees.filter((a) => !a?.self && !a?.organizer);
  if (others.length >= 2) return 'meeting';
  if (others.length === 1) return 'meeting';
  return 'event';
}

function parseAttendees(item) {
  const attendees = Array.isArray(item?.attendees) ? item.attendees : [];
  return attendees
    .map((a) => String(a?.email || '').trim())
    .filter(Boolean);
}

/**
 * @param {*} env
 * @param {{ user_id: string, tenant_id?: string|null, workspace_id?: string|null, account_identifier?: string, account_email?: string }} tokenMeta
 */
export async function syncGoogleCalendarForTokenRow(env, tokenMeta) {
  if (!env?.DB) return { ok: false, synced: 0, error: 'no_db' };

  const userId = String(tokenMeta.user_id || '').trim();
  const account = String(tokenMeta.account_identifier || tokenMeta.account_email || '').trim().toLowerCase();
  const workspaceId = String(tokenMeta.workspace_id || env.WORKSPACE_ID || '').trim();
  const tenantId = String(tokenMeta.tenant_id || env.TENANT_ID || '').trim() || null;

  if (!userId || !account || !workspaceId) {
    return { ok: false, synced: 0, error: 'missing_scope' };
  }

  const row = await getIntegrationOAuthRow(env, userId, GOOGLE_CALENDAR_PROVIDER, account);
  const accessToken = row?.access_token ? String(row.access_token) : '';
  if (!accessToken) return { ok: false, synced: 0, error: 'no_token' };

  const { timeMin, timeMax } = googleEventWindow();
  const listUrl = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  listUrl.searchParams.set('singleEvents', 'true');
  listUrl.searchParams.set('orderBy', 'startTime');
  listUrl.searchParams.set('timeMin', timeMin);
  listUrl.searchParams.set('timeMax', timeMax);
  listUrl.searchParams.set('maxResults', '250');

  const res = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      synced: 0,
      error: data?.error?.message || `google_calendar_http_${res.status}`,
    };
  }

  const items = Array.isArray(data.items) ? data.items : [];
  let synced = 0;
  const seenExternal = new Set();

  for (const item of items) {
    const externalId = String(item?.id || '').trim();
    if (!externalId) continue;

    if (item?.status === 'cancelled') {
      await env.DB.prepare(
        `DELETE FROM calendar_events
         WHERE workspace_id = ? AND external_event_id = ? AND lower(sync_account) = ?`,
      )
        .bind(workspaceId, externalId, account)
        .run()
        .catch(() => null);
      continue;
    }

    seenExternal.add(externalId);

    const startRaw = item?.start?.dateTime || (item?.start?.date ? `${item.start.date}T00:00:00` : null);
    const endRaw =
      item?.end?.dateTime ||
      (item?.end?.date ? `${item.end.date}T23:59:59` : null) ||
      startRaw;
    const start_datetime = toSqlDateTimeFromIso(startRaw);
    const end_datetime = toSqlDateTimeFromIso(endRaw);
    if (!start_datetime || !end_datetime) continue;

    const title = String(item?.summary || '(No title)').trim().slice(0, 200);
    const description = item?.description ? String(item.description).slice(0, 4000) : null;
    const location = item?.location ? String(item.location).slice(0, 400) : null;
    const htmlLink = item?.htmlLink ? String(item.htmlLink) : null;
    const event_type = inferEventType(item);
    const attendees = parseAttendees(item);
    const allDay = item?.start?.date && !item?.start?.dateTime ? 1 : 0;

    const existing = await env.DB.prepare(
      `SELECT id FROM calendar_events
       WHERE workspace_id = ? AND external_event_id = ? AND lower(sync_account) = ?
       LIMIT 1`,
    )
      .bind(workspaceId, externalId, account)
      .first()
      .catch(() => null);

    const id = existing?.id || `gce_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    if (existing?.id) {
      await env.DB.prepare(
        `UPDATE calendar_events SET
           title = ?, description = ?, location = ?,
           start_datetime = ?, end_datetime = ?, event_type = ?,
           attendees = ?, all_day = ?, status = 'scheduled', updated_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(
          title,
          description,
          location,
          start_datetime,
          end_datetime,
          event_type,
          JSON.stringify(attendees),
          allDay,
          id,
        )
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO calendar_events (
           id, tenant_id, workspace_id, event_type, title, description, location,
           start_datetime, end_datetime, color, status, attendees, created_by,
           calendar_source, external_event_id, sync_account, all_day, updated_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '#039be5', 'scheduled', ?, ?, 'google_calendar', ?, ?, ?, datetime('now'), datetime('now'))`,
      )
        .bind(
          id,
          tenantId,
          workspaceId,
          event_type,
          title,
          description,
          location,
          start_datetime,
          end_datetime,
          JSON.stringify(attendees),
          userId,
          externalId,
          account,
          allDay,
        )
        .run();
    }

    synced += 1;
  }

  try {
    await env.DB.prepare(
      `UPDATE user_oauth_tokens SET metadata_json = ?, updated_at = unixepoch()
       WHERE user_id = ? AND lower(provider) = 'google_calendar'
         AND lower(account_identifier) = ?`,
    )
      .bind(
        JSON.stringify({
          last_sync_at: new Date().toISOString(),
          last_sync_count: synced,
          html_link: 'https://calendar.google.com',
        }),
        userId,
        account,
      )
      .run();
  } catch {
    /* non-fatal */
  }

  return { ok: true, synced, account, seen: seenExternal.size };
}

/** @param {*} env */
export async function runGoogleCalendarSyncCron(env) {
  if (!env?.DB) return { ok: false, accounts: 0, synced: 0 };

  const rows = await listAllGoogleCalendarTokenRows(env);
  let totalSynced = 0;
  let okAccounts = 0;

  for (const row of rows) {
    const workspaceId =
      row.workspace_id ||
      (await env.DB.prepare(`SELECT workspace_id FROM auth_users WHERE id = ? LIMIT 1`)
        .bind(row.user_id)
        .first()
        .then((r) => r?.workspace_id)
        .catch(() => null)) ||
      env.WORKSPACE_ID;

    const out = await syncGoogleCalendarForTokenRow(env, {
      user_id: row.user_id,
      tenant_id: row.tenant_id,
      workspace_id: workspaceId,
      account_identifier: row.account_identifier,
      account_email: row.account_email,
    });
    if (out.ok) {
      okAccounts += 1;
      totalSynced += out.synced || 0;
    } else {
      console.warn('[google-calendar-sync]', row.account_identifier, out.error);
    }
  }

  return { ok: true, accounts: rows.length, synced: totalSynced, ok_accounts: okAccounts };
}
