/**
 * src/api/mail.js
 * Email client API (inbox, detail, templates, sending).
 *
 * All routes are auth-gated via getAuthUser.
 */

import { getAuthUser } from '../core/auth.js';
import { jsonResponse } from '../core/responses.js';
import { sendPlatformEmail, sendUserGmail } from '../lib/email.js';
import { resolveOAuthAccessToken, resolveOAuthRefreshToken } from './oauth.js';
import {
  listGmailTokenRowsForUser,
  getGmailTokenRowForUser,
} from '../core/gmail-user-tokens.js';
import { resolveIntegrationUserId } from '../../backend/identity/oauth/integration-user-id.js';
import { disconnectGmailAccount } from './integrations/gmail-connect.js';
import {
  emailSentLogKey,
  getEmailR2Bucket,
  getEmailSentLogObject,
} from '../../backend/services/email/r2-email.js';
import { emailLogExternalId, emailLogProvider, insertEmailLog, looksLikeGmailMessageId } from '../../backend/services/email/email-log.js';
import { receivedEmailsScopeClause } from '../core/resend-inbound.js';

const PAGE_SIZE = 50;
const GMAIL_LIST_MAX = 50;

function pathLower(url) {
  return url.pathname.toLowerCase().replace(/\/$/, '') || '/';
}

function parsePage(url) {
  const raw = url.searchParams.get('page');
  const n = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function safeJsonParse(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    const s = String(raw);
    if (!s.trim()) return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function mapEmailLogRow(logRow) {
  return {
    id: String(logRow.id),
    from_address: String(logRow.from_email || logRow.from_address || ''),
    to_address: String(logRow.to_email || logRow.to_address || ''),
    subject: String(logRow.subject || '(no subject)'),
    date_received: String(logRow.created_at || ''),
    is_read: 1,
    is_starred: 0,
    is_archived: 0,
    category: String(logRow.status || 'sent'),
    has_attachments: 0,
  };
}

async function loadSentLogBody(env, authUser, logId, logRow) {
  const dbText = logRow?.text_content != null ? String(logRow.text_content).trim() : '';
  if (dbText) return dbText;

  try {
    const obj = await getEmailSentLogObject(env, logId);
    if (obj) {
      const payload = safeJsonParse(await obj.text());
      if (payload) {
        const html = payload.html != null ? String(payload.html).trim() : '';
        const text = payload.text != null ? String(payload.text).trim() : '';
        if (html) return html;
        if (text) return text;
      }
    }
  } catch {
    /* fall through */
  }

  const extId = emailLogExternalId(logRow);
  const provider = emailLogProvider(logRow, extId);
  if (!extId || provider !== 'gmail' || !looksLikeGmailMessageId(extId)) return null;

  const gmailTok = await getGmailTokenRow(env, authUser);
  const gmailAccessToken = gmailTok ? await resolveOAuthAccessToken(env, gmailTok) : null;
  if (!gmailAccessToken) return null;

  const got = await gmailGetMessage(env, gmailTok, extId, 'full');
  if (!got.ok || !got.msg) return null;
  const bodies = extractGmailBodies(got.msg);
  return bodies.html || bodies.text || (got.msg?.snippet ? String(got.msg.snippet) : null);
}

async function archiveSentEmailPayload(env, logId, payload) {
  const bucket = getEmailR2Bucket(env);
  if (!bucket) return;
  try {
    await bucket.put(emailSentLogKey(logId), JSON.stringify(payload), {
      httpMetadata: { contentType: 'application/json' },
    });
  } catch (e) {
    console.warn('[mail/send] R2 archive put failed', e?.message ?? e);
  }
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function mustDb(env) {
  return !!env?.DB;
}

function replaceTemplateVars(template, vars) {
  const v = vars && typeof vars === 'object' ? vars : {};
  let out = String(template ?? '');
  for (const [k, val] of Object.entries(v)) {
    const key = String(k);
    const value = val == null ? '' : String(val);
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

function base64UrlEncode(input) {
  const bin = typeof input === 'string' ? input : String(input ?? '');
  const bytes = new TextEncoder().encode(bin);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  const b64 = btoa(str);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecodeToString(b64url) {
  const s = String(b64url || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function firstHeader(msg, name) {
  const want = String(name || '').toLowerCase();
  const headers = msg?.payload?.headers;
  if (!Array.isArray(headers)) return '';
  const h = headers.find((x) => String(x?.name || '').toLowerCase() === want);
  return h?.value ? String(h.value) : '';
}

function parseGmailCategories(labelIds) {
  const set = new Set((Array.isArray(labelIds) ? labelIds : []).map((x) => String(x)));
  if (set.has('CATEGORY_PROMOTIONS')) return 'promotions';
  if (set.has('CATEGORY_SOCIAL')) return 'social';
  if (set.has('CATEGORY_UPDATES')) return 'updates';
  if (set.has('CATEGORY_FORUMS')) return 'forums';
  if (set.has('CATEGORY_PERSONAL') || set.has('CATEGORY_PRIMARY')) return 'primary';
  return '';
}

function hasGmailAttachments(msg) {
  const stack = [msg?.payload].filter(Boolean);
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (n.filename && n.body?.attachmentId) return true;
    if (Array.isArray(n.parts)) stack.push(...n.parts);
  }
  return false;
}

function extractGmailBodies(msg) {
  let html = '';
  let text = '';
  const walk = (node) => {
    if (!node) return;
    const mt = String(node.mimeType || '').toLowerCase();
    const data = node?.body?.data ? String(node.body.data) : '';
    if (data && mt === 'text/html' && !html) html = base64UrlDecodeToString(data);
    if (data && mt === 'text/plain' && !text) text = base64UrlDecodeToString(data);
    const parts = Array.isArray(node.parts) ? node.parts : [];
    if (!parts.length) return;
    const alt = parts.filter((p) => String(p?.mimeType || '').toLowerCase().includes('alternative'));
    const nested = parts.filter((p) => String(p?.mimeType || '').toLowerCase() === 'message/rfc822');
    const rest = parts.filter((p) => !alt.includes(p) && !nested.includes(p));
    for (const p of [...alt, ...nested, ...rest]) walk(p);
  };
  walk(msg?.payload);
  return { html, text };
}

function listGmailAttachments(msg) {
  const out = [];
  const stack = [msg?.payload].filter(Boolean);
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    const filename = n.filename ? String(n.filename) : '';
    const attachmentId = n?.body?.attachmentId ? String(n.body.attachmentId) : '';
    const size = Number(n?.body?.size || 0);
    const contentType = n?.mimeType ? String(n.mimeType) : 'application/octet-stream';
    if (filename && attachmentId) {
      out.push({ id: attachmentId, filename, content_type: contentType, size });
    }
    if (Array.isArray(n.parts)) stack.push(...n.parts);
  }
  return out;
}

function buildRfc2822Message({ from, to, subject, bodyText, bodyHtml, inReplyTo, references }) {
  const lines = [];
  const now = new Date();
  lines.push(`Date: ${now.toUTCString()}`);
  if (from) lines.push(`From: ${from}`);
  if (to) lines.push(`To: ${to}`);
  if (subject) lines.push(`Subject: ${subject}`);
  lines.push('MIME-Version: 1.0');
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);

  const hasHtml = !!(bodyHtml && String(bodyHtml).trim());
  const hasText = !!(bodyText && String(bodyText).trim());
  const text = hasText ? String(bodyText) : '';
  const html = hasHtml ? String(bodyHtml) : '';

  if (hasHtml) {
    const boundary = `iam_${crypto.randomUUID().replace(/-/g, '')}`;
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(text || html.replace(/<[^>]+>/g, ''));
    lines.push('');
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(html);
    lines.push('');
    lines.push(`--${boundary}--`);
  } else {
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(text);
  }
  return lines.join('\r\n');
}

async function listGmailTokenRows(env, authUser) {
  return listGmailTokenRowsForUser(env, authUser);
}

async function getGmailTokenRow(env, authUser, accountIdentifier = null) {
  return getGmailTokenRowForUser(env, authUser, accountIdentifier);
}

async function resolveGmailTokensForRequest(env, authUser, accountParam) {
  const raw = accountParam ? String(accountParam).trim() : '';
  if (raw === 'all') {
    const rows = await listGmailTokenRows(env, authUser);
    const out = [];
    for (const row of rows) {
      const tok = await resolveOAuthAccessToken(env, row);
      if (tok) out.push(row);
    }
    return out;
  }
  if (raw) {
    const row = await getGmailTokenRow(env, authUser, raw);
    if (!row) return [];
    const tok = await resolveOAuthAccessToken(env, row);
    return tok ? [row] : [];
  }
  const rows = await listGmailTokenRows(env, authUser);
  if (!rows.length) return [];
  const primary = rows[0];
  const tok = await resolveOAuthAccessToken(env, primary);
  return tok ? [primary] : [];
}

function mapGmailMetadataToEmail(msg, accountIdentifier = '') {
  const labelIds = Array.isArray(msg?.labelIds) ? msg.labelIds : [];
  const unread = labelIds.includes('UNREAD') ? 0 : 1;
  const starred = labelIds.includes('STARRED') ? 1 : 0;
  const archived = labelIds.includes('INBOX') ? 0 : 1;
  const subject = firstHeader(msg, 'Subject') || '(no subject)';
  const from = firstHeader(msg, 'From') || '';
  const to = firstHeader(msg, 'To') || '';
  const dt = msg?.internalDate ? new Date(Number(msg.internalDate)) : null;
  const date_received = dt && !Number.isNaN(dt.getTime()) ? dt.toISOString() : new Date().toISOString();
  return {
    id: String(msg.id),
    from_address: from,
    to_address: to,
    subject,
    date_received,
    is_read: unread,
    is_starred: starred,
    is_archived: archived,
    category: parseGmailCategories(labelIds),
    has_attachments: hasGmailAttachments(msg) ? 1 : 0,
    account: accountIdentifier ? String(accountIdentifier) : '',
  };
}

async function fetchGmailFolderEmails(env, tokenRows, folder, opts = {}) {
  const pageToken = opts.pageToken ? String(opts.pageToken) : null;
  const allEmails = [];
  let nextPageToken = null;
  let resultSizeEstimate = null;
  for (const tokenRow of tokenRows) {
    const acct = String(tokenRow.account_identifier || '').trim();
    let list;
    if (folder === 'archived') {
      list = await gmailListMessagesQuery(env, tokenRow, 'in:all -in:inbox -in:trash -in:spam -in:drafts', pageToken);
    } else if (folder === 'sent') {
      list = await gmailListMessages(env, tokenRow, ['SENT'], pageToken);
    } else if (folder === 'starred') {
      list = await gmailListMessages(env, tokenRow, ['STARRED'], pageToken);
    } else {
      list = await gmailListMessages(env, tokenRow, ['INBOX'], pageToken);
    }
    if (!list.ok) return { ok: false, status: list.status, error: list.error, emails: [] };
    nextPageToken = list.nextPageToken || nextPageToken;
    resultSizeEstimate = list.resultSizeEstimate ?? resultSizeEstimate;
    const ids = (list.messages || []).map((m) => String(m?.id || '')).filter(Boolean);
    for (const id of ids) {
      const m = await gmailGetMessage(env, tokenRow, id, 'metadata');
      if (m.ok && m.msg) allEmails.push(mapGmailMetadataToEmail(m.msg, acct));
    }
  }
  allEmails.sort((a, b) => new Date(b.date_received).getTime() - new Date(a.date_received).getTime());
  return {
    ok: true,
    emails: allEmails,
    next_page_token: nextPageToken,
    total_estimate: resultSizeEstimate,
    page_size: GMAIL_LIST_MAX,
  };
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
       WHERE user_id = ? AND provider = ? AND account_identifier = ?`
    ).bind(refreshed.access_token, exp, tokenRow.user_id, tokenRow.provider, tokenRow.account_identifier || '').run();
  } catch {
    // ignore
  }
  return { access_token: refreshed.access_token, expires_at: exp };
}

async function gmailFetchJson(env, tokenRow, url, init) {
  const tok = tokenRow ? (await resolveOAuthAccessToken(env, tokenRow) || '') : '';
  if (!tok) return { ok: false, status: 401, json: null };
  let res = await fetch(url, {
    ...(init || {}),
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${tok}`,
    },
  });
  if (res.status === 401 && (await resolveOAuthRefreshToken(env, tokenRow))) {
    const refreshed = await refreshGoogleAccessToken(env, tokenRow);
    if (refreshed?.access_token) {
      res = await fetch(url, {
        ...(init || {}),
        headers: {
          ...(init?.headers || {}),
          Authorization: `Bearer ${refreshed.access_token}`,
        },
      });
    }
  }
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}

async function gmailListMessages(env, tokenRow, labelIds, pageToken = null) {
  const u = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  u.searchParams.set('maxResults', String(GMAIL_LIST_MAX));
  if (pageToken) u.searchParams.set('pageToken', String(pageToken));
  for (const l of (Array.isArray(labelIds) ? labelIds : [])) u.searchParams.append('labelIds', String(l));
  const out = await gmailFetchJson(env, tokenRow, u.toString());
  if (!out.ok) return { ok: false, status: out.status, error: out.json?.error?.message || 'gmail list failed', messages: [], nextPageToken: null };
  return {
    ok: true,
    messages: Array.isArray(out.json?.messages) ? out.json.messages : [],
    nextPageToken: out.json?.nextPageToken ? String(out.json.nextPageToken) : null,
    resultSizeEstimate: out.json?.resultSizeEstimate ?? null,
  };
}

async function gmailListMessagesQuery(env, tokenRow, query, pageToken = null) {
  const u = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  u.searchParams.set('maxResults', String(GMAIL_LIST_MAX));
  if (pageToken) u.searchParams.set('pageToken', String(pageToken));
  if (query) u.searchParams.set('q', String(query));
  const out = await gmailFetchJson(env, tokenRow, u.toString());
  if (!out.ok) return { ok: false, status: out.status, error: out.json?.error?.message || 'gmail list failed', messages: [], nextPageToken: null };
  return {
    ok: true,
    messages: Array.isArray(out.json?.messages) ? out.json.messages : [],
    nextPageToken: out.json?.nextPageToken ? String(out.json.nextPageToken) : null,
    resultSizeEstimate: out.json?.resultSizeEstimate ?? null,
  };
}

async function gmailModifyMessage(env, tokenRow, messageId, { addLabelIds = [], removeLabelIds = [] } = {}) {
  const add = (Array.isArray(addLabelIds) ? addLabelIds : []).map(String).filter(Boolean);
  const remove = (Array.isArray(removeLabelIds) ? removeLabelIds : []).map(String).filter(Boolean);
  if (!add.length && !remove.length) return { ok: true };
  const u = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`;
  const body = {};
  if (add.length) body.addLabelIds = add;
  if (remove.length) body.removeLabelIds = remove;
  const out = await gmailFetchJson(env, tokenRow, u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!out.ok) return { ok: false, status: out.status, error: out.json?.error?.message || 'gmail modify failed' };
  return { ok: true, json: out.json };
}

async function applyGmailEmailPatch(env, tokenRow, messageId, patch) {
  const add = [];
  const remove = [];
  if ('is_read' in patch) {
    if (patch.is_read) remove.push('UNREAD');
    else add.push('UNREAD');
  }
  if ('is_starred' in patch) {
    if (patch.is_starred) add.push('STARRED');
    else remove.push('STARRED');
  }
  if ('is_archived' in patch && patch.is_archived) {
    remove.push('INBOX');
  }
  return gmailModifyMessage(env, tokenRow, messageId, { addLabelIds: add, removeLabelIds: remove });
}

async function trashGmailMessage(env, tokenRow, messageId) {
  return gmailModifyMessage(env, tokenRow, messageId, { addLabelIds: ['TRASH'], removeLabelIds: ['INBOX'] });
}

async function gmailGetMessage(env, tokenRow, id, format = 'metadata') {
  const u = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`);
  u.searchParams.set('format', format);
  if (format === 'metadata') {
    ['From', 'To', 'Subject', 'Date', 'Message-Id', 'In-Reply-To', 'References'].forEach((h) => u.searchParams.append('metadataHeaders', h));
  }
  const out = await gmailFetchJson(env, tokenRow, u.toString());
  if (!out.ok) return { ok: false, status: out.status, error: out.json?.error?.message || 'gmail get failed', msg: null };
  return { ok: true, msg: out.json };
}

async function gmailGetAttachment(env, tokenRow, msgId, attachmentId) {
  const u = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(msgId)}/attachments/${encodeURIComponent(attachmentId)}`;
  const out = await gmailFetchJson(env, tokenRow, u);
  if (!out.ok) return { ok: false, status: out.status, error: out.json?.error?.message || 'gmail attachment failed', data: null };
  const data = out.json?.data ? String(out.json.data) : '';
  return { ok: true, data };
}

async function gmailSendMessage(env, tokenRow, raw, threadId) {
  const u = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
  const body = threadId ? { raw, threadId } : { raw };
  const out = await gmailFetchJson(env, tokenRow, u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!out.ok) return { ok: false, status: out.status, error: out.json?.error?.message || 'gmail send failed' };
  return { ok: true, json: out.json };
}

export async function handleMailApi(request, url, env, ctx) {
  const p = pathLower(url);
  const method = request.method.toUpperCase();

  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!mustDb(env)) return jsonResponse({ error: 'DB not configured' }, 503);

  // Canonical user_id and tenant_id for all email_logs queries — scopes data to this user only.
  const mailUserId =
    (await resolveIntegrationUserId(env, authUser)) ||
    (authUser.id ? String(authUser.id).trim() : '');
  const mailTenantId = authUser.tenant_id ? String(authUser.tenant_id).trim() : '';
  const receivedScope = receivedEmailsScopeClause(mailTenantId, mailUserId);

  try {
    // POST /api/mail/agent-continue — pick a next-step chip in Mail → Agent Sam turn
    if (method === 'POST' && p === '/api/mail/agent-continue') {
      let body = {};
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
      }
      const conversationId = String(body.conversationId || body.conversation_id || '').trim();
      const instruction = String(body.instruction || body.message || '').trim();
      if (!conversationId || !instruction) {
        return jsonResponse({ error: 'conversationId and instruction required' }, 400);
      }
      const { runAgentTurnFromPushAction } = await import('../core/email-agent-bridge.js');
      const result = await runAgentTurnFromPushAction(env, ctx || { waitUntil() {} }, {
        conversationId,
        instruction,
        action: String(body.action || 'mail_chip').slice(0, 32),
      });
      return jsonResponse({
        ok: !!result?.ok || !!result?.accepted,
        accepted: !!result?.accepted,
        conversationId,
        error: result?.error,
      });
    }

    // GET /api/mail/by-ref?c=<conversationId> — resolve phone-loop sent mail for deep link
    if (method === 'GET' && p === '/api/mail/by-ref') {
      const c = String(url.searchParams.get('c') || url.searchParams.get('conversation') || '')
        .trim()
        .replace(/^as_/i, '');
      if (!c) return jsonResponse({ error: 'c required' }, 400);
      const needle = `%[ref:as_${c}]%`;
      const row = await env.DB.prepare(
        `SELECT id, from_email, to_email, from_address, to_address, subject, status,
                external_message_id, provider, resend_id, created_at, text_content
         FROM email_logs
         WHERE user_id = ?
           AND (text_content LIKE ? OR subject LIKE ?)
         ORDER BY created_at DESC
         LIMIT 1`,
      )
        .bind(mailUserId, needle, `%${c}%`)
        .first()
        .catch(() => null);
      if (!row?.id) return jsonResponse({ error: 'not_found', conversationId: c }, 404);
      return jsonResponse({
        email: mapEmailLogRow(row),
        conversationId: c,
        source: 'sent',
      });
    }

    // Gmail OAuth connect (real)
    // GET /api/mail/gmail/status
    if (method === 'GET' && p === '/api/mail/gmail/status') {
      const rows = await listGmailTokenRows(env, authUser);
      const accounts = [];
      for (const tok of rows) {
        const refresh = await resolveOAuthRefreshToken(env, tok);
        const access = await resolveOAuthAccessToken(env, tok);
        if (!refresh && !access) continue;
        accounts.push({
          id: String(tok.account_identifier || ''),
          address: String(tok.account_identifier || ''),
          expires_at: tok?.expires_at != null ? Number(tok.expires_at) : null,
          scope: tok?.scope ? String(tok.scope) : null,
        });
      }
      const primary = accounts[0] || null;
      return jsonResponse({
        connected: accounts.length > 0,
        account: primary?.address || null,
        accounts,
        expires_at: primary?.expires_at ?? null,
        scope: primary?.scope ?? null,
      });
    }

    // GET /api/mail/gmail/accounts
    if (method === 'GET' && p === '/api/mail/gmail/accounts') {
      const rows = await listGmailTokenRows(env, authUser);
      const accounts = [];
      for (const tok of rows) {
        const refresh = await resolveOAuthRefreshToken(env, tok);
        const access = await resolveOAuthAccessToken(env, tok);
        if (!refresh && !access) continue;
        accounts.push({
          id: String(tok.account_identifier || ''),
          address: String(tok.account_identifier || ''),
          label: 'Gmail',
          provider: 'gmail',
          connected: true,
        });
      }
      return jsonResponse({ accounts });
    }

    // DELETE /api/mail/gmail/disconnect?account=email@domain.com
    if (method === 'DELETE' && p === '/api/mail/gmail/disconnect') {
      const acct = url.searchParams.get('account') ? String(url.searchParams.get('account')).trim() : '';
      if (!acct) return jsonResponse({ error: 'account required' }, 400);
      const result = await disconnectGmailAccount(env, authUser, acct);
      if (!result.ok) return jsonResponse({ error: result.error || 'disconnect_failed' }, 400);
      return jsonResponse({ ok: true, account: acct.toLowerCase() });
    }

    // Legacy alias → unified Gmail connect spine
    if (method === 'GET' && p === '/api/mail/gmail/start') {
      const returnTo = url.searchParams.get('return_to') || '/dashboard/mail';
      const target = new URL(`${url.origin}/api/integrations/gmail/connect`);
      target.searchParams.set('return_to', returnTo);
      if (url.searchParams.get('popup') === '1') target.searchParams.set('popup', '1');
      return Response.redirect(target.toString(), 302);
    }

    if (method === 'GET' && p === '/api/mail/gmail/callback') {
      const target = new URL(`${url.origin}/api/integrations/gmail/callback`);
      for (const [k, v] of url.searchParams.entries()) target.searchParams.set(k, v);
      return Response.redirect(target.toString(), 302);
    }

    // GET /api/mail/inbox
    if (method === 'GET' && p === '/api/mail/inbox') {
      const accountParam = url.searchParams.get('account');
      const gmailTokens = await resolveGmailTokensForRequest(env, authUser, accountParam);
      if (gmailTokens.length > 0) {
        const pageToken = url.searchParams.get('page_token') || null;
        const fetched = await fetchGmailFolderEmails(env, gmailTokens, 'inbox', { pageToken });
        if (!fetched.ok) return jsonResponse({ error: fetched.error }, fetched.status || 502);
        const emails = fetched.emails;
        const page = parsePage(url);
        return jsonResponse({
          emails,
          total: fetched.total_estimate ?? emails.length,
          page,
          page_size: fetched.page_size || GMAIL_LIST_MAX,
          next_page_token: fetched.next_page_token || null,
          unread_count: emails.filter((e) => e.is_read === 0).length,
          source: 'gmail',
        });
      }

      const page = parsePage(url);
      const offset = (page - 1) * PAGE_SIZE;
      const category = url.searchParams.get('category');
      const unread = url.searchParams.get('unread') === '1';

      const where = [receivedScope.sql, 'is_archived = 0'];
      const binds = [...receivedScope.binds];
      if (category && category.trim()) {
        where.push('category = ?');
        binds.push(category.trim());
      }
      if (unread) where.push('is_read = 0');

      const whereSql = `WHERE ${where.join(' AND ')}`;

      const [rows, totalRow, unreadRow] = await Promise.all([
        env.DB.prepare(
          `SELECT id, from_address, to_address, subject, date_received, is_read, is_starred, is_archived, category, has_attachments
           FROM received_emails
           ${whereSql}
           ORDER BY date_received DESC
           LIMIT ? OFFSET ?`
        ).bind(...binds, PAGE_SIZE, offset).all(),
        env.DB.prepare(
          `SELECT COUNT(*) as c FROM received_emails ${whereSql}`
        ).bind(...binds).first(),
        env.DB.prepare(
          `SELECT COUNT(*) as c FROM received_emails WHERE ${receivedScope.sql} AND is_archived = 0 AND is_read = 0`
        ).bind(...receivedScope.binds).first(),
      ]);

      return jsonResponse({
        emails: rows?.results || [],
        total: Number(totalRow?.c || 0),
        page,
        page_size: PAGE_SIZE,
        unread_count: Number(unreadRow?.c || 0),
      });
    }

    // GET /api/mail/starred
    if (method === 'GET' && p === '/api/mail/starred') {
      const accountParam = url.searchParams.get('account');
      const gmailTokens = await resolveGmailTokensForRequest(env, authUser, accountParam);
      if (gmailTokens.length > 0) {
        const pageToken = url.searchParams.get('page_token') || null;
        const fetched = await fetchGmailFolderEmails(env, gmailTokens, 'starred', { pageToken });
        if (!fetched.ok) return jsonResponse({ error: fetched.error }, fetched.status || 502);
        return jsonResponse({
          emails: fetched.emails,
          source: 'gmail',
          next_page_token: fetched.next_page_token || null,
          page_size: fetched.page_size || GMAIL_LIST_MAX,
        });
      }
      const { results } = await env.DB.prepare(
        `SELECT id, from_address, to_address, subject, date_received, is_read, is_starred, is_archived, category, has_attachments
         FROM received_emails
         WHERE ${receivedScope.sql} AND is_starred = 1
         ORDER BY date_received DESC
         LIMIT 100`
      ).bind(...receivedScope.binds).all();
      return jsonResponse({ emails: results || [] });
    }

    // GET /api/mail/archived
    if (method === 'GET' && p === '/api/mail/archived') {
      const accountParam = url.searchParams.get('account');
      const gmailTokens = await resolveGmailTokensForRequest(env, authUser, accountParam);
      if (gmailTokens.length > 0) {
        const pageToken = url.searchParams.get('page_token') || null;
        const fetched = await fetchGmailFolderEmails(env, gmailTokens, 'archived', { pageToken });
        if (!fetched.ok) return jsonResponse({ error: fetched.error }, fetched.status || 502);
        const emails = fetched.emails;
        return jsonResponse({
          emails,
          total: fetched.total_estimate ?? emails.length,
          page: parsePage(url),
          page_size: fetched.page_size || GMAIL_LIST_MAX,
          next_page_token: fetched.next_page_token || null,
          source: 'gmail',
        });
      }
      const page = parsePage(url);
      const offset = (page - 1) * PAGE_SIZE;
      const [rows, totalRow] = await Promise.all([
        env.DB.prepare(
          `SELECT id, from_address, to_address, subject, date_received, is_read, is_starred, is_archived, category, has_attachments
           FROM received_emails
           WHERE ${receivedScope.sql} AND is_archived = 1
           ORDER BY date_received DESC
           LIMIT ? OFFSET ?`
        ).bind(...receivedScope.binds, PAGE_SIZE, offset).all(),
        env.DB.prepare(
          `SELECT COUNT(*) as c FROM received_emails WHERE ${receivedScope.sql} AND is_archived = 1`
        ).bind(...receivedScope.binds).first(),
      ]);

      return jsonResponse({
        emails: rows?.results || [],
        total: Number(totalRow?.c || 0),
        page,
      });
    }

    // GET /api/mail/outbound — platform notification_outbox (digest / system email queue)
    if (method === 'GET' && p === '/api/mail/outbound') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50) || 50, 1), 100);
      if (!mailTenantId) {
        return jsonResponse({ emails: [], total: 0, source: 'outbox', unread_count: 0 });
      }
      try {
        const { results } = await env.DB.prepare(
          `SELECT id, channel, to_address, subject, body_text, status, event_type,
                  attempts, max_attempts, last_error, created_at, updated_at
           FROM notification_outbox
           WHERE tenant_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
          .bind(mailTenantId, limit)
          .all();
        const emails = (results || []).map((row) => ({
          id: String(row.id),
          from_address: 'notifications@inneranimalmedia.com',
          to_address: String(row.to_address || ''),
          subject: String(row.subject || '(no subject)'),
          date_received:
            row.created_at != null
              ? new Date(Number(row.created_at) < 1e12 ? Number(row.created_at) * 1000 : Number(row.created_at)).toISOString()
              : '',
          is_read: String(row.status || '') === 'sent' ? 1 : 0,
          is_starred: 0,
          is_archived: 0,
          has_attachments: 0,
          category: String(row.channel || 'email'),
          account: 'outbound',
          _outbox: {
            status: row.status,
            event_type: row.event_type,
            attempts: row.attempts,
            max_attempts: row.max_attempts,
            last_error: row.last_error,
            body_text: row.body_text,
          },
        }));
        return jsonResponse({
          emails,
          total: emails.length,
          page_size: limit,
          source: 'outbox',
          unread_count: emails.filter((e) => !e.is_read).length,
        });
      } catch (e) {
        return jsonResponse({ error: String(e?.message || e), emails: [], total: 0 }, 500);
      }
    }

    // GET /api/mail/sent — Gmail SENT label when connected; D1 email_logs fallback + platform audit rows
    if (method === 'GET' && p === '/api/mail/sent') {
      const accountParam = url.searchParams.get('account');
      const gmailTokens = await resolveGmailTokensForRequest(env, authUser, accountParam);
      const pageToken = url.searchParams.get('page_token') || null;
      const page = parsePage(url);

      const statusParam = url.searchParams.get('status');
      const status = statusParam && statusParam.trim() ? statusParam.trim().toLowerCase() : null;
      const allowedStatuses = new Set(['sent', 'draft', 'queued', 'failed']);
      const includeAll = !status || status === 'all';
      const statusFilter = (!includeAll && allowedStatuses.has(status)) ? status : null;
      const statusSql = statusFilter ? `status = ?` : `status IN ('sent','draft')`;
      const d1Binds = statusFilter ? [mailUserId, statusFilter] : [mailUserId];

      const d1Promise = env.DB.prepare(
        `SELECT id,
                COALESCE(from_email, from_address) AS from_address,
                COALESCE(to_email, to_address) AS to_address,
                subject, status, created_at
         FROM email_logs
         WHERE user_id = ? AND ${statusSql}
         ORDER BY created_at DESC
         LIMIT 30`,
      ).bind(...d1Binds).all();

      if (gmailTokens.length > 0) {
        const fetched = await fetchGmailFolderEmails(env, gmailTokens, 'sent', { pageToken });
        if (!fetched.ok) return jsonResponse({ error: fetched.error }, fetched.status || 502);
        const gmailEmails = fetched.emails || [];
        const d1Res = await d1Promise.catch(() => ({ results: [] }));
        const d1Only = (d1Res?.results || []).filter((row) => {
          const ext = String(row.id || '');
          return !looksLikeGmailMessageId(ext);
        });
        const merged = [
          ...gmailEmails,
          ...d1Only.map((row) => ({
            id: String(row.id),
            from_address: String(row.from_address || ''),
            to_address: String(row.to_address || ''),
            subject: String(row.subject || '(no subject)'),
            date_received: String(row.created_at || ''),
            is_read: 1,
            is_starred: 0,
            is_archived: 0,
            category: String(row.status || 'sent'),
            has_attachments: 0,
            source: 'platform',
          })),
        ];
        merged.sort((a, b) => new Date(b.date_received).getTime() - new Date(a.date_received).getTime());
        return jsonResponse({
          emails: merged,
          total: fetched.total_estimate ?? merged.length,
          page,
          page_size: fetched.page_size || GMAIL_LIST_MAX,
          next_page_token: fetched.next_page_token || null,
          source: 'gmail',
          platform_log_count: d1Only.length,
        });
      }

      const offset = (page - 1) * PAGE_SIZE;
      const [listRes, totalRow] = await Promise.all([
        env.DB.prepare(
          `SELECT id,
                  COALESCE(from_email, from_address) AS from_address,
                  COALESCE(to_email, to_address) AS to_address,
                  subject, status, created_at
           FROM email_logs
           WHERE user_id = ? AND ${statusSql}
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`,
        ).bind(...d1Binds, PAGE_SIZE, offset).all(),
        env.DB.prepare(
          `SELECT COUNT(*) as c FROM email_logs WHERE user_id = ? AND ${statusSql}`,
        ).bind(...d1Binds).first(),
      ]);

      return jsonResponse({
        emails: listRes?.results || [],
        total: Number(totalRow?.c || 0),
        page,
        page_size: PAGE_SIZE,
        source: 'd1',
      });
    }

    // GET /api/mail/email/:id — scoped to authUser for email_logs rows
    if (method === 'GET' && p.startsWith('/api/mail/email/')) {
      const id = decodeURIComponent(url.pathname.split('/').pop() || '').trim();
      if (!id) return jsonResponse({ error: 'Not found' }, 404);

      const logRow = await env.DB.prepare(
        `SELECT id, from_email, to_email, from_address, to_address, subject, status,
                external_message_id, provider, resend_id, created_at, text_content
         FROM email_logs
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
      ).bind(id, mailUserId).first();
      if (logRow) {
        const body = await loadSentLogBody(env, authUser, id, logRow);
        const { parseNextStepsFromBody } = await import('../core/email-reply-thread.js');
        const next = parseNextStepsFromBody(body || '');
        return jsonResponse({
          email: mapEmailLogRow(logRow),
          body,
          attachments: [],
          thread: [],
          metadata: {
            source: 'email_logs',
            status: logRow.status,
            conversationId: next.conversationId,
            nextSteps: next.steps,
          },
          source: 'sent',
        });
      }

      const gmailAccount = url.searchParams.get('account');
      if (looksLikeGmailMessageId(id)) {
        const tokenCandidates = gmailAccount
          ? [await getGmailTokenRow(env, authUser, gmailAccount)]
          : await listGmailTokenRows(env, authUser);
        for (const gmailTok of tokenCandidates) {
          if (!gmailTok) continue;
          const gmailAccessToken = await resolveOAuthAccessToken(env, gmailTok);
          if (!gmailAccessToken) continue;
          const got = await gmailGetMessage(env, gmailTok, id, 'full');
          if (!got.ok || !got.msg) continue;
          const msg = got.msg;
        const labelIds = Array.isArray(msg?.labelIds) ? msg.labelIds : [];
        const dt = msg?.internalDate ? new Date(Number(msg.internalDate)) : null;
        const date_received = dt && !Number.isNaN(dt.getTime()) ? dt.toISOString() : new Date().toISOString();
        const email = {
          id: String(msg.id),
          from_address: firstHeader(msg, 'From') || '',
          to_address: firstHeader(msg, 'To') || '',
          subject: firstHeader(msg, 'Subject') || '(no subject)',
          date_received,
          is_read: labelIds.includes('UNREAD') ? 0 : 1,
          is_starred: labelIds.includes('STARRED') ? 1 : 0,
          is_archived: labelIds.includes('INBOX') ? 0 : 1,
          category: parseGmailCategories(labelIds),
          has_attachments: hasGmailAttachments(msg) ? 1 : 0,
          account: gmailTok?.account_identifier ? String(gmailTok.account_identifier) : '',
          metadata: {
            message_id: firstHeader(msg, 'Message-Id') || '',
            in_reply_to: firstHeader(msg, 'In-Reply-To') || '',
            references: firstHeader(msg, 'References') || '',
            thread_id: msg?.threadId ? String(msg.threadId) : '',
            label_ids: labelIds,
            snippet: msg?.snippet ? String(msg.snippet) : '',
          },
        };

        const bodies = extractGmailBodies(msg);
        const body = bodies.html || bodies.text || (msg?.snippet ? String(msg.snippet) : null);
        const attachments = listGmailAttachments(msg);

        return jsonResponse({
          email,
          body,
          attachments,
          thread: [],
          metadata: email.metadata,
          source: 'gmail',
        });
        }
        return jsonResponse({ error: 'Email not found' }, 404);
      }

      const email = await env.DB.prepare(
        `SELECT *
         FROM received_emails
         WHERE id = ? AND ${receivedScope.sql}
         LIMIT 1`
      ).bind(id, ...receivedScope.binds).first();

      if (!email) return jsonResponse({ error: 'Email not found' }, 404);

      // Mark read (non-blocking)
      await env.DB.prepare(
        `UPDATE received_emails
         SET is_read = 1, updated_at = datetime('now')
         WHERE id = ? AND ${receivedScope.sql}`
      ).bind(id, ...receivedScope.binds).run().catch(() => {});

      let body = null;
      const r2Key = email?.r2_key ? String(email.r2_key).trim() : '';
      const emailBucket = getEmailR2Bucket(env);
      if (r2Key && emailBucket) {
        try {
          const obj = await emailBucket.get(r2Key);
          if (obj) {
            body = await obj.text();
          }
        } catch {
          body = null;
        }
      }

      const [attachmentsRows, threadRows] = await Promise.all([
        env.DB.prepare(
          `SELECT id, filename, content_type, size
           FROM email_attachments
           WHERE email_id = ?
           ORDER BY filename ASC`
        ).bind(id).all().catch(() => ({ results: [] })),
        email?.in_reply_to
          ? env.DB.prepare(
              `SELECT id, from_address, subject, date_received, is_read
               FROM received_emails
               WHERE ${receivedScope.sql}
                 AND (message_id = ? OR in_reply_to = ?)
               ORDER BY date_received ASC
               LIMIT 20`
            ).bind(...receivedScope.binds, String(email.in_reply_to), String(email.in_reply_to)).all().catch(() => ({ results: [] }))
          : Promise.resolve({ results: [] }),
      ]);

      const metadata = safeJsonParse(email?.metadata);

      return jsonResponse({
        email: { ...email, is_read: 1 },
        body,
        attachments: attachmentsRows?.results || [],
        thread: threadRows?.results || [],
        metadata,
      });
    }

    // GET /api/mail/attachment/:messageId/:attachmentId (Gmail only)
    if (method === 'GET' && p.startsWith('/api/mail/attachment/')) {
      const parts = url.pathname.split('/').filter(Boolean);
      const msgId = parts[3] ? decodeURIComponent(parts[3]) : '';
      const attachmentId = parts[4] ? decodeURIComponent(parts[4]) : '';
      if (!msgId || !attachmentId) return jsonResponse({ error: 'Not found' }, 404);
      const accountParam = url.searchParams.get('account');
      const gmailTok = await getGmailTokenRow(env, authUser, accountParam || null);
      const gmailAccessToken = gmailTok ? await resolveOAuthAccessToken(env, gmailTok) : null;
      if (!gmailAccessToken) return jsonResponse({ error: 'Gmail not connected' }, 403);
      const got = await gmailGetAttachment(env, gmailTok, msgId, attachmentId);
      if (!got.ok) return jsonResponse({ error: got.error }, got.status || 502);
      const data = got.data ? String(got.data) : '';
      const binStr = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
      return new Response(bytes, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'private, max-age=0, no-store',
        },
      });
    }

    // GET /api/mail/templates
    if (method === 'GET' && p === '/api/mail/templates') {
      const { results } = await env.DB.prepare(
        `SELECT id, name, category, subject, variables, is_active
         FROM email_templates
         WHERE is_active = 1
         ORDER BY category, name`
      ).all();
      return jsonResponse({ templates: results || [] });
    }

    // GET /api/mail/senders
    if (method === 'GET' && p === '/api/mail/senders') {
      const rows = await listGmailTokenRows(env, authUser);
      const senders = [];
      for (const gmailTok of rows) {
        const gmailAccessToken = await resolveOAuthAccessToken(env, gmailTok);
        const gmailRefreshResolved = await resolveOAuthRefreshToken(env, gmailTok);
        if (!gmailAccessToken && !gmailRefreshResolved) continue;
        const account_identifier = String(gmailTok.account_identifier || '');
        senders.push({
          id: `gmail:${account_identifier}`,
          address: account_identifier,
          display_name: account_identifier,
          label: 'Gmail',
          purpose: 'gmail',
        });
      }
      if (senders.length > 0) return jsonResponse({ senders });
      if (!mailTenantId) return jsonResponse({ senders: [] });
      const { results } = await env.DB.prepare(
        `SELECT id, address, display_name, label, purpose
         FROM resend_emails
         WHERE status = 'active' AND can_send = 1 AND tenant_id = ?
         ORDER BY purpose, address`
      ).bind(mailTenantId).all();
      return jsonResponse({ senders: results || [] });
    }

    // GET /api/mail/labels
    if (method === 'GET' && p === '/api/mail/labels') {
      const { results } = await env.DB.prepare(
        `SELECT label, COUNT(*) as count
         FROM email_labels
         GROUP BY label
         ORDER BY count DESC`
      ).all();
      return jsonResponse({ labels: results || [] });
    }

    // GET /api/mail/stats
    if (method === 'GET' && p === '/api/mail/stats') {
      const accountParam = url.searchParams.get('account');
      const gmailTokens = await resolveGmailTokensForRequest(env, authUser, accountParam);
      if (gmailTokens.length > 0) {
        const fetched = await fetchGmailFolderEmails(env, gmailTokens, 'inbox');
        if (fetched.ok) {
          const emails = fetched.emails;
          const starredFetched = await fetchGmailFolderEmails(env, gmailTokens, 'starred');
          return jsonResponse({
            total: emails.length,
            unread: emails.filter((e) => e.is_read === 0).length,
            starred: starredFetched.ok ? starredFetched.emails.length : 0,
            categories: [],
            source: 'gmail',
          });
        }
      }

      const safeFirst = (q, binds = []) =>
        env.DB.prepare(q).bind(...binds).first().catch(() => null);
      const safeAll = (q, binds = []) =>
        env.DB.prepare(q).bind(...binds).all().catch(() => ({ results: [] }));

      const scopeSql = receivedScope.sql;
      const scopeBinds = receivedScope.binds;
      const [totalRow, unreadRow, starredRow, categoriesRows] = await Promise.all([
        safeFirst(
          `SELECT COUNT(*) as c FROM received_emails WHERE ${scopeSql} AND is_archived = 0`,
          scopeBinds,
        ),
        safeFirst(
          `SELECT COUNT(*) as c FROM received_emails WHERE ${scopeSql} AND is_read = 0 AND is_archived = 0`,
          scopeBinds,
        ),
        safeFirst(
          `SELECT COUNT(*) as c FROM received_emails WHERE ${scopeSql} AND is_starred = 1`,
          scopeBinds,
        ),
        safeAll(
          `SELECT category, COUNT(*) as count
           FROM received_emails
           WHERE ${scopeSql} AND is_archived = 0
           GROUP BY category`,
          scopeBinds,
        ),
      ]);

      return jsonResponse({
        total: Number(totalRow?.c || 0),
        unread: Number(unreadRow?.c || 0),
        starred: Number(starredRow?.c || 0),
        categories: categoriesRows?.results || [],
      });
    }

    // PATCH /api/mail/email/:id
    if (method === 'PATCH' && p.startsWith('/api/mail/email/')) {
      const id = decodeURIComponent(url.pathname.split('/').pop() || '').trim();
      if (!id) return jsonResponse({ error: 'Not found' }, 404);

      const body = await readJsonBody(request);
      if (!body || typeof body !== 'object') return jsonResponse({ error: 'Invalid JSON body' }, 400);

      if (looksLikeGmailMessageId(id)) {
        const accountParam = body.account || url.searchParams.get('account');
        const gmailTok = await getGmailTokenRow(env, authUser, accountParam || null);
        const gmailAccessToken = gmailTok ? await resolveOAuthAccessToken(env, gmailTok) : null;
        if (gmailAccessToken) {
          const patch = {};
          if ('is_read' in body) patch.is_read = body.is_read ? 1 : 0;
          if ('is_starred' in body) patch.is_starred = body.is_starred ? 1 : 0;
          if ('is_archived' in body) patch.is_archived = body.is_archived ? 1 : 0;
          const mod = await applyGmailEmailPatch(env, gmailTok, id, patch);
          if (!mod.ok) return jsonResponse({ error: mod.error || 'gmail modify failed' }, mod.status || 502);
          return jsonResponse({ ok: true, source: 'gmail' });
        }
      }

      const allowed = ['is_read', 'is_starred', 'is_archived', 'category'];
      const sets = [];
      const binds = [];
      for (const k of allowed) {
        if (!(k in body)) continue;
        sets.push(`${k} = ?`);
        binds.push(body[k]);
      }

      if (sets.length === 0) {
        return jsonResponse({ ok: true });
      }

      sets.push(`updated_at = datetime('now')`);

      await env.DB.prepare(
        `UPDATE received_emails
         SET ${sets.join(', ')}
         WHERE id = ? AND ${receivedScope.sql}`
      ).bind(...binds, id, ...receivedScope.binds).run();

      return jsonResponse({ ok: true });
    }

    // POST /api/mail/label
    if (method === 'POST' && p === '/api/mail/label') {
      const body = await readJsonBody(request);
      const emailId = body?.email_id ? String(body.email_id).trim() : '';
      const label = body?.label ? String(body.label).trim() : '';
      if (!emailId || !label) return jsonResponse({ error: 'email_id and label required' }, 400);

      await env.DB.prepare(
        `INSERT OR IGNORE INTO email_labels (id, email_id, label, created_at)
         VALUES (lower(hex(randomblob(8))), ?, ?, datetime('now'))`
      ).bind(emailId, label).run();

      return jsonResponse({ ok: true });
    }

    // DELETE /api/mail/label
    if (method === 'DELETE' && p === '/api/mail/label') {
      const body = await readJsonBody(request);
      const emailId = body?.email_id ? String(body.email_id).trim() : '';
      const label = body?.label ? String(body.label).trim() : '';
      if (!emailId || !label) return jsonResponse({ error: 'email_id and label required' }, 400);

      await env.DB.prepare(
        `DELETE FROM email_labels WHERE email_id = ? AND label = ?`
      ).bind(emailId, label).run();

      return jsonResponse({ ok: true });
    }

    // POST /api/mail/send
    if (method === 'POST' && p === '/api/mail/send') {
      const body = await readJsonBody(request);
      const providerRaw =
        body?.provider != null && String(body.provider).trim() !== ''
          ? String(body.provider).trim().toLowerCase()
          : '';
      const from = body?.from ? String(body.from).trim() : '';
      const to = body?.to ? String(body.to).trim() : '';
      const subjectRaw = body?.subject != null ? String(body.subject) : '';
      const subject = subjectRaw.trim();

      if (providerRaw === 'gmail') {
        if (!to || !subject) return jsonResponse({ error: 'to and subject are required' }, 400);
        let html = body?.html != null ? String(body.html) : '';
        let text = body?.text != null ? String(body.text) : '';
        const result = await sendUserGmail(env, authUser.id, {
          to,
          subject,
          html: html || undefined,
          text: text || undefined,
        });
        if (!result.ok) {
          const err = result.error || '';
          if (err === 'no_google_oauth' || err === 'no_sender_identity') {
            return jsonResponse(
              { error: 'Gmail not connected. Go to Settings → Integrations to connect Google.' },
              403,
            );
          }
          return jsonResponse({ error: err || 'send_failed' }, 502);
        }
        return jsonResponse({ ok: true, provider: 'gmail', id: result.id || null });
      }

      if (providerRaw === 'resend' || providerRaw === 'platform') {
        if (!to || !subject) return jsonResponse({ error: 'to and subject are required' }, 400);
        const html = body?.html != null ? String(body.html) : '';
        const text = body?.text != null ? String(body.text) : '';
        const r = await sendPlatformEmail(env, {
          to,
          subject,
          html: html || undefined,
          text: text || undefined,
          from: from || undefined,
        });
        if (!r.success) {
          return jsonResponse({ error: r.error || 'send_failed' }, r.error === 'no_resend_key' ? 503 : 502);
        }
        return jsonResponse({
          ok: true,
          provider: 'platform',
          ...(r.data?.id ? { id: String(r.data.id) } : {}),
        });
      }

      if (!from || !to || !subject) {
        return jsonResponse({ error: 'from, to, subject are required' }, 400);
      }

      let html = body?.html != null ? String(body.html) : '';
      let text = body?.text != null ? String(body.text) : '';
      const templateId = body?.template_id ? String(body.template_id).trim() : '';
      const vars = body?.vars && typeof body.vars === 'object' ? body.vars : {};
      const replyTo = body?.reply_to ? String(body.reply_to).trim() : '';

      if (templateId) {
        const tpl = await env.DB.prepare(
          `SELECT html_content, text_content FROM email_templates WHERE id = ? LIMIT 1`
        ).bind(templateId).first();
        if (tpl) {
          html = replaceTemplateVars(tpl.html_content, vars);
          text = replaceTemplateVars(tpl.text_content, vars);
        }
      } else {
        html = replaceTemplateVars(html, vars);
        text = replaceTemplateVars(text, vars);
      }

      // If Gmail is connected and "from" matches the connected account, send via Gmail API.
      const gmailTok = await getGmailTokenRow(env, authUser);
      const connectedAcct = gmailTok?.account_identifier ? String(gmailTok.account_identifier).trim().toLowerCase() : '';
      const fromLower = from.toLowerCase();
      const gmailAccessToken = gmailTok ? await resolveOAuthAccessToken(env, gmailTok) : null;
      const wantsGmail = !!(gmailAccessToken && connectedAcct && fromLower.includes(connectedAcct));
      const threadId = body?.thread_id ? String(body.thread_id).trim() : '';
      const inReplyTo = body?.in_reply_to ? String(body.in_reply_to).trim() : '';
      const references = body?.references ? String(body.references).trim() : '';

      if (wantsGmail) {
        const raw = base64UrlEncode(buildRfc2822Message({
          from,
          to,
          subject,
          bodyText: text || html,
          bodyHtml: html || '',
          inReplyTo: inReplyTo || '',
          references: references || '',
        }));
        const sent = await gmailSendMessage(env, gmailTok, raw, threadId || '');
        if (!sent.ok) return jsonResponse({ error: sent.error }, sent.status || 502);
        // Also log to email_logs for Sent UI — scoped to authUser.
        const logId = crypto.randomUUID();
        const gmailMsgId = String(sent.json?.id || '');
        await insertEmailLog(env, {
          id: logId,
          to,
          from,
          subject,
          status: 'sent',
          externalMessageId: gmailMsgId,
          provider: 'gmail',
          userId: mailUserId,
          tenantId: mailTenantId,
        });
        await archiveSentEmailPayload(env, logId, {
          id: logId,
          external_message_id: gmailMsgId,
          provider: 'gmail',
          from,
          to,
          subject,
          html: html || null,
          text: text || null,
          sent_at: new Date().toISOString(),
        });
        return jsonResponse({ ok: true, provider: 'gmail', id: gmailMsgId, log_id: logId });
      }

      const platformSend = await sendPlatformEmail(env, {
        from,
        to,
        subject,
        html: html || undefined,
        text: text || undefined,
      });
      if (!platformSend.success) {
        const st = platformSend.error === 'no_resend_key' || platformSend.error === 'no_service_account'
          ? 503
          : 502;
        return jsonResponse({ error: platformSend.error || 'send_failed' }, st);
      }
      const data = platformSend.data || {};
      const resendId =
        typeof data?.id === 'string' && data.id.trim()
          ? data.id.trim()
          : crypto?.randomUUID?.() || 'sent';
      const logId = crypto.randomUUID();
      const archivePayload = {
        id: logId,
        external_message_id: resendId,
        provider: 'resend',
        from,
        to,
        subject,
        html: html || null,
        text: text || null,
        sent_at: new Date().toISOString(),
      };

      await insertEmailLog(env, {
        id: logId,
        to,
        from,
        subject,
        status: 'sent',
        externalMessageId: resendId,
        provider: 'resend',
        userId: mailUserId,
        tenantId: mailTenantId,
      });

      await archiveSentEmailPayload(env, logId, archivePayload);

      return jsonResponse({ ok: true, id: resendId, log_id: logId });
    }

    // POST /api/mail/draft — scoped to authUser
    if (method === 'POST' && p === '/api/mail/draft') {
      const body = await readJsonBody(request);
      const from = body?.from != null ? String(body.from).trim() : '';
      const to = body?.to != null ? String(body.to).trim() : '';
      const subject = body?.subject != null ? String(body.subject).trim() : '';

      // Prefer SQL-generated id with RETURNING; fallback to crypto.randomUUID for compatibility.
      let id = null;
      try {
        const row = await env.DB.prepare(
          `INSERT INTO email_logs (id, to_email, from_email, subject, status, user_id, tenant_id, created_at, updated_at)
           VALUES (lower(hex(randomblob(16))), ?, ?, ?, 'draft', ?, ?, datetime('now'), datetime('now'))
           RETURNING id`
        ).bind(to, from, subject, mailUserId, mailTenantId).first();
        id = row?.id ? String(row.id) : null;
      } catch {
        id = crypto?.randomUUID?.() || String(Date.now());
        await env.DB.prepare(
          `INSERT INTO email_logs (id, to_email, from_email, subject, status, user_id, tenant_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, datetime('now'), datetime('now'))`
        ).bind(id, to, from, subject, mailUserId, mailTenantId).run();
      }

      return jsonResponse({ ok: true, id });
    }

    // DELETE /api/mail/email/:id (Gmail trash or D1 soft-delete)
    if (method === 'DELETE' && p.startsWith('/api/mail/email/')) {
      const id = decodeURIComponent(url.pathname.split('/').pop() || '').trim();
      if (!id) return jsonResponse({ error: 'Not found' }, 404);

      if (looksLikeGmailMessageId(id)) {
        const accountParam = url.searchParams.get('account');
        const gmailTok = await getGmailTokenRow(env, authUser, accountParam || null);
        const gmailAccessToken = gmailTok ? await resolveOAuthAccessToken(env, gmailTok) : null;
        if (gmailAccessToken) {
          const mod = await trashGmailMessage(env, gmailTok, id);
          if (!mod.ok) return jsonResponse({ error: mod.error || 'gmail trash failed' }, mod.status || 502);
          return jsonResponse({ ok: true, source: 'gmail' });
        }
      }

      await env.DB.prepare(
        `UPDATE received_emails
         SET is_archived = 1, updated_at = datetime('now')
         WHERE id = ? AND ${receivedScope.sql}`
      ).bind(id, ...receivedScope.binds).run();

      return jsonResponse({ ok: true });
    }

    // POST /api/mail/agent — RETIRED (2026-07-13). This was a dead prototype: same
    // direct-Gemini-JSON pattern as the daily-memory cron triage step, but with no
    // callers (Mail UI uses openMailAgent → /api/agent/chat with real Gmail tools).
    // Keeping a second live Gemini JSON path was exactly the confusion that led to
    // needing this note in the first place — delete rather than repurpose. If
    // on-demand triage is ever needed outside of chat, build it as a thin route
    // that calls triageEmailsParallel() from the cron pipeline, not a duplicate.
    if (method === 'POST' && p === '/api/mail/agent') {
      return jsonResponse(
        {
          error: 'Endpoint retired',
          message:
            'POST /api/mail/agent was a legacy prototype with no callers and has been removed. ' +
            'Use the Mail Agent Sam chat (openMailAgent → /api/agent/chat) instead.',
        },
        410,
      );
    }

    return jsonResponse({ error: 'Mail route not found', path: url.pathname }, 404);
  } catch (e) {
    return jsonResponse({ error: String(e?.message || e) }, 500);
  }
}
