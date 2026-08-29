/**
 * Cron-safe Gmail inbox snapshot (no HTTP auth session).
 * Reads user_oauth_tokens for google_gmail by canonical au_* user id.
 */

import { resolveOAuthAccessToken, resolveOAuthRefreshToken } from '../api/oauth.js';
import { listGmailTokenRowsForUser } from './gmail-user-tokens.js';

const DEFAULT_MAX = 50;
const MAX_PER_ACCOUNT_CAP = 120;

/**
 * @param {{ hoursBack?: number, sinceMidnightChicago?: boolean, searchAnywhere?: boolean }} opts
 */
function buildGmailListQuery(opts = {}) {
  const anywhere = opts.searchAnywhere ? 'in:anywhere ' : '';
  if (opts.sinceMidnightChicago) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${anywhere}after:${y}/${m}/${d}`.trim();
  }
  const hours = Number(opts.hoursBack);
  if (hours > 0 && hours <= 24) return `${anywhere}newer_than:1d`.trim();
  if (hours > 24 && hours <= 48) return `${anywhere}newer_than:2d`.trim();
  if (hours > 48) return `${anywhere}newer_than:${Math.ceil(hours / 24)}d`.trim();
  return `${anywhere}newer_than:2d`.trim();
}

function firstHeader(msg, name) {
  const want = String(name || '').toLowerCase();
  const headers = msg?.payload?.headers;
  if (!Array.isArray(headers)) return '';
  const h = headers.find((x) => String(x?.name || '').toLowerCase() === want);
  return h?.value ? String(h.value) : '';
}

async function refreshGoogleAccessToken(env, tokenRow) {
  const rt = await resolveOAuthRefreshToken(env, tokenRow);
  if (!rt) return null;
  if (!env?.GOOGLE_CLIENT_ID || !env?.GOOGLE_OAUTH_CLIENT_SECRET) return null;
  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: rt,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const refreshed = await refreshRes.json().catch(() => null);
  if (!refreshRes.ok || !refreshed?.access_token) return null;
  const exp = Math.floor(Date.now() / 1000) + Number(refreshed.expires_in || 3600);
  try {
    await env.DB.prepare(
      `UPDATE user_oauth_tokens
       SET access_token = ?, expires_at = ?, updated_at = unixepoch()
       WHERE user_id = ? AND lower(provider) IN ('google_gmail', 'gmail')
         AND account_identifier = ?`
    ).bind(refreshed.access_token, exp, tokenRow.user_id, tokenRow.account_identifier || '').run();
  } catch { /* ignore */ }
  return { access_token: refreshed.access_token };
}

async function gmailFetchJson(env, tokenRow, url, init) {
  const tok = tokenRow ? (await resolveOAuthAccessToken(env, tokenRow) || '') : '';
  if (!tok) return { ok: false, status: 401, json: null };
  let res = await fetch(url, {
    ...(init || {}),
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${tok}` },
  });
  if (res.status === 401 && (await resolveOAuthRefreshToken(env, tokenRow))) {
    const refreshed = await refreshGoogleAccessToken(env, tokenRow);
    if (refreshed?.access_token) {
      res = await fetch(url, {
        ...(init || {}),
        headers: { ...(init?.headers || {}), Authorization: `Bearer ${refreshed.access_token}` },
      });
    }
  }
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

/**
 * @param {*} env
 * @param {{ email?: string, userId?: string, maxPerAccount?: number, hoursBack?: number, sinceMidnightChicago?: boolean, gmailQuery?: string, searchAnywhere?: boolean }} opts
 */
export async function snapshotGmailInboxForUser(env, opts = {}) {
  const userId = opts.userId ? String(opts.userId).trim() : '';
  const email = opts.email ? String(opts.email).trim().toLowerCase() : '';
  const maxRaw = Number(opts.maxPerAccount) > 0 ? Number(opts.maxPerAccount) : DEFAULT_MAX;
  const max = Math.min(maxRaw, MAX_PER_ACCOUNT_CAP);
  const searchAnywhere = opts.searchAnywhere === true
    || String(opts.gmailQuery || '').includes('in:anywhere');
  const listQuery = opts.gmailQuery?.trim()
    || buildGmailListQuery({
      hoursBack: opts.hoursBack,
      sinceMidnightChicago: opts.sinceMidnightChicago,
      searchAnywhere,
    });
  const authUser = userId || email ? { id: userId || undefined, email: email || undefined } : null;
  if (!authUser) return { emails: [], accounts: [], source: 'none' };

  const tokens = await listGmailTokenRowsForUser(env, authUser);

  const emails = [];
  const accounts = [];
  for (const tokenRow of tokens) {
    const acct = String(tokenRow.account_identifier || '').trim();
    if (!acct) continue;
    const access = await resolveOAuthAccessToken(env, tokenRow);
    const refresh = await resolveOAuthRefreshToken(env, tokenRow);
    if (!access && !refresh) continue;
    accounts.push(acct);

    const u = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    u.searchParams.set('maxResults', String(max));
    if (!searchAnywhere) {
      u.searchParams.append('labelIds', 'INBOX');
    }
    u.searchParams.set('q', listQuery);
    const list = await gmailFetchJson(env, tokenRow, u.toString());
    if (!list.ok) continue;

    const ids = (Array.isArray(list.json?.messages) ? list.json.messages : [])
      .map((m) => String(m?.id || '')).filter(Boolean);
    for (const id of ids) {
      const detailUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`);
      detailUrl.searchParams.set('format', 'metadata');
      ['From', 'To', 'Subject', 'Date'].forEach((h) => detailUrl.searchParams.append('metadataHeaders', h));
      const got = await gmailFetchJson(env, tokenRow, detailUrl.toString());
      if (!got.ok || !got.json) continue;
      const msg = got.json;
      const labelIds = Array.isArray(msg?.labelIds) ? msg.labelIds : [];
      const dt = msg?.internalDate ? new Date(Number(msg.internalDate)) : null;
      emails.push({
        id: String(msg.id),
        account: acct,
        from_address: firstHeader(msg, 'From') || '',
        to_address: firstHeader(msg, 'To') || '',
        subject: firstHeader(msg, 'Subject') || '(no subject)',
        date_received: dt && !Number.isNaN(dt.getTime()) ? dt.toISOString() : '',
        is_read: labelIds.includes('UNREAD') ? 0 : 1,
        is_starred: labelIds.includes('STARRED') ? 1 : 0,
        snippet: msg?.snippet ? String(msg.snippet).slice(0, 280) : '',
      });
    }
  }

  emails.sort((a, b) => new Date(b.date_received).getTime() - new Date(a.date_received).getTime());
  const cap = max * Math.max(accounts.length, 1);
  return {
    emails: emails.slice(0, cap),
    accounts,
    source: accounts.length ? 'gmail' : 'none',
    query: listQuery,
  };
}
