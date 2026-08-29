/**
 * Gmail agent tools — user-scoped via session au_* tokens (never platform secrets).
 */
import { resolveOAuthAccessToken, resolveOAuthRefreshToken } from '../../../src/api/oauth.js';
import {
  GMAIL_PROVIDER,
  getGmailTokenRowForUser,
  listGmailTokenRowsForUser,
} from '../../../src/core/gmail-user-tokens.js';
import { snapshotGmailInboxForUser } from '../../../src/core/gmail-inbox-snapshot.js';
import { sendUserGmail } from '../../../src/lib/email.js';

function resolveAuthUser(runContext) {
  const userId = String(
    runContext?.userId ?? runContext?.user_id ?? runContext?.authUserId ?? '',
  ).trim();
  const email = String(runContext?.userEmail ?? runContext?.email ?? '').trim();
  if (!userId && !email) return null;
  return { id: userId || undefined, email: email || undefined };
}

async function refreshGoogleAccessToken(env, tokenRow) {
  const rt = await resolveOAuthRefreshToken(env, tokenRow);
  if (!rt || !env?.GOOGLE_CLIENT_ID) return null;
  const secret =
    typeof env.GOOGLE_CLIENT_SECRET === 'string' && env.GOOGLE_CLIENT_SECRET.trim()
      ? env.GOOGLE_CLIENT_SECRET.trim()
      : typeof env.GOOGLE_OAUTH_CLIENT_SECRET === 'string'
        ? env.GOOGLE_OAUTH_CLIENT_SECRET.trim()
        : '';
  if (!secret) return null;
  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: secret,
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
         AND account_identifier = ?`,
    )
      .bind(refreshed.access_token, exp, tokenRow.user_id, tokenRow.account_identifier || '')
      .run();
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
    for (const p of parts) walk(p);
  };
  walk(msg?.payload);
  return { html, text };
}

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {Record<string, unknown>} params
 * @param {*} env
 * @param {Record<string, unknown>} runContext
 */
async function gmailGetMessage(params, env, runContext) {
  const authUser = resolveAuthUser(runContext);
  if (!authUser) return { error: 'user_session_required' };
  const messageId = String(params.message_id ?? params.messageId ?? '').trim();
  if (!messageId) return { error: 'message_id_required' };
  const account = params.account ? String(params.account).trim() : '';
  const tokenRow = await getGmailTokenRowForUser(env, authUser, account || null);
  if (!tokenRow) {
    return { error: 'gmail_not_connected', connect_url: '/api/integrations/gmail/connect?return_to=/dashboard/mail' };
  }
  const u = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`);
  u.searchParams.set('format', 'full');
  const out = await gmailFetchJson(env, tokenRow, u.toString());
  if (!out.ok || !out.json) {
    return { error: out.json?.error?.message || 'gmail_get_message_failed', status: out.status };
  }
  const msg = out.json;
  const bodies = extractGmailBodies(msg);
  const bodyText = (bodies.text || stripHtmlToText(bodies.html) || String(msg.snippet || '')).trim();
  const max = 8000;
  return {
    ok: true,
    provider: GMAIL_PROVIDER,
    message_id: String(msg.id || messageId),
    account: tokenRow.account_identifier,
    thread_id: msg.threadId ? String(msg.threadId) : null,
    from_address: firstHeader(msg, 'From'),
    to_address: firstHeader(msg, 'To'),
    subject: firstHeader(msg, 'Subject') || '(no subject)',
    date_received: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : '',
    snippet: msg.snippet ? String(msg.snippet).slice(0, 500) : '',
    body_text: bodyText.slice(0, max),
    body_truncated: bodyText.length > max,
    label_ids: Array.isArray(msg.labelIds) ? msg.labelIds.map(String) : [],
  };
}

/**
 * @param {Record<string, unknown>} params
 * @param {*} env
 * @param {Record<string, unknown>} runContext
 */
async function gmailListInbox(params, env, runContext) {
  const authUser = resolveAuthUser(runContext);
  if (!authUser?.id && !authUser?.email) {
    return { error: 'user_session_required', connect_url: '/api/integrations/gmail/connect?return_to=/dashboard/mail' };
  }
  const max = Number(params.max_results ?? params.max ?? 25) || 25;
  const account = params.account ? String(params.account).trim() : '';
  const snapshot = await snapshotGmailInboxForUser(env, {
    userId: authUser.id,
    email: authUser.email,
    maxPerAccount: max,
  });
  let emails = snapshot.emails || [];
  if (account) {
    const want = account.toLowerCase();
    emails = emails.filter((e) => String(e.account || '').toLowerCase() === want);
  }
  const rows = await listGmailTokenRowsForUser(env, authUser);
  return {
    provider: GMAIL_PROVIDER,
    accounts: snapshot.accounts || rows.map((r) => r.account_identifier).filter(Boolean),
    emails,
    total: emails.length,
  };
}

/**
 * @param {Record<string, unknown>} params
 * @param {*} env
 * @param {Record<string, unknown>} runContext
 */
async function gmailModifyMessage(params, env, runContext) {
  const authUser = resolveAuthUser(runContext);
  if (!authUser) return { error: 'user_session_required' };
  const messageId = String(params.message_id ?? params.messageId ?? '').trim();
  if (!messageId) return { error: 'message_id_required' };
  const account = params.account ? String(params.account).trim() : '';
  const tokenRow = await getGmailTokenRowForUser(env, authUser, account || null);
  if (!tokenRow) {
    return { error: 'gmail_not_connected', connect_url: '/api/integrations/gmail/connect?return_to=/dashboard/mail' };
  }
  const add = Array.isArray(params.add_label_ids)
    ? params.add_label_ids.map(String)
    : params.add_label_ids
      ? [String(params.add_label_ids)]
      : [];
  const remove = Array.isArray(params.remove_label_ids)
    ? params.remove_label_ids.map(String)
    : params.remove_label_ids
      ? [String(params.remove_label_ids)]
      : [];
  if ('is_read' in params) {
    if (params.is_read) remove.push('UNREAD');
    else add.push('UNREAD');
  }
  if ('is_starred' in params) {
    if (params.is_starred) add.push('STARRED');
    else remove.push('STARRED');
  }
  if ('is_archived' in params && params.is_archived) remove.push('INBOX');
  if ('trash' in params && params.trash) {
    add.push('TRASH');
    remove.push('INBOX');
  }
  if (!add.length && !remove.length) return { error: 'no_label_changes' };
  const u = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`;
  const body = {};
  if (add.length) body.addLabelIds = add;
  if (remove.length) body.removeLabelIds = remove;
  const out = await gmailFetchJson(env, tokenRow, u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!out.ok) {
    return { error: out.json?.error?.message || 'gmail_modify_failed', status: out.status };
  }
  return { ok: true, message_id: messageId, account: tokenRow.account_identifier, result: out.json };
}

/**
 * @param {Record<string, unknown>} params
 * @param {*} env
 * @param {Record<string, unknown>} runContext
 */
async function gmailSend(params, env, runContext) {
  const authUser = resolveAuthUser(runContext);
  if (!authUser?.id) return { error: 'user_session_required' };
  const to = String(params.to ?? '').trim();
  const subject = String(params.subject ?? '').trim();
  const body = String(params.body ?? params.text ?? '').trim();
  if (!to || !subject) return { error: 'to_and_subject_required' };
  try {
    const sent = await sendUserGmail(env, authUser.id, {
      to,
      subject,
      text: body,
      html: params.html ? String(params.html) : undefined,
      account: params.account ? String(params.account) : undefined,
    });
    return { ok: true, provider: GMAIL_PROVIDER, ...sent };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

export const handlers = {
  gmail_list_inbox: gmailListInbox,
  gmail_get_message: gmailGetMessage,
  gmail_modify_message: gmailModifyMessage,
  gmail_send: gmailSend,
};
