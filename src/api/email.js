/**
 * POST /api/email/send
 * Internal / scripted sends (deploy hooks, automation).
 * Auth: AGENTSAM_BRIDGE_KEY (Bearer or X-Internal-Secret).
 *
 * Deploy notifications (scripts/deploy-frontend.sh) may include HTML built from
 * Supabase `build_deploy_events` fields: worker_version_id, git_commit_sha, git_message,
 * git_branch, environment, deployed_by, duration_ms, started_at, and optional AI cost fields.
 *
 * Primary: Resend. Fallback: Gmail API via GOOGLE_SERVICE_ACCOUNT_JSON JWT
 * (optional domain-wide delegation: GMAIL_DELEGATED_USER impersonates ONE Workspace
 * mailbox for platform automation — not per-user OAuth / MCP / agent mail).
 */
import { jsonResponse } from '../core/auth.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { logAndArchiveSentEmail } from '../../backend/services/email/email-sent-archive.js';

/** Deploy hooks / automation: AGENTSAM_BRIDGE_KEY . */
function isEmailSendAuthorized(request, env) {
  if (verifyBridgeKey(request, env)) return true;
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const bridge = env?.AGENTSAM_BRIDGE_KEY != null ? String(env.AGENTSAM_BRIDGE_KEY).trim() : '';
  return !!(bridge && bearer === bridge);
}

function b64UrlEncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlEncodeRaw(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** OAuth access token for gmail.send (optional KV cache). */
async function getGmailSendAccessToken(env) {
  if (env.KV) {
    const cached = await env.KV.get('gmail_send:access_token');
    if (cached) return cached;
  }
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw || typeof raw !== 'string') throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured');
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const header = b64UrlEncodeUtf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const deleg =
    (env.GMAIL_DELEGATED_USER && String(env.GMAIL_DELEGATED_USER).trim()) ||
    (env.GMAIL_IMPERSONATE_USER && String(env.GMAIL_IMPERSONATE_USER).trim()) ||
    '';
  const payloadObj = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/gmail.send',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now - 60,
  };
  if (deleg) payloadObj.sub = deleg;
  const payload = b64UrlEncodeUtf8(JSON.stringify(payloadObj));
  const pem = sa.private_key;
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${b64UrlEncodeRaw(signature)}`;
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const tokJson = await tokenResp.json();
  if (!tokenResp.ok || !tokJson.access_token) {
    const err = tokJson.error_description || tokJson.error || 'token exchange failed';
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  if (env.KV) {
    await env.KV.put('gmail_send:access_token', tokJson.access_token, { expirationTtl: 3300 });
  }
  return tokJson.access_token;
}

function buildRfc2822({ from, to, subject, html, text }) {
  const boundary = `b_${crypto.randomUUID?.() || Date.now()}`;
  const body =
    html && text
      ? [
          `MIME-Version: 1.0`,
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
          '',
          `--${boundary}`,
          'Content-Type: text/plain; charset=UTF-8',
          '',
          text,
          '',
          `--${boundary}`,
          'Content-Type: text/html; charset=UTF-8',
          '',
          html,
          '',
          `--${boundary}--`,
        ].join('\r\n')
      : html
        ? ['MIME-Version: 1.0', 'Content-Type: text/html; charset=UTF-8', '', html].join('\r\n')
        : ['MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '', text || ''].join('\r\n');

  const head = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
  ].join('\r\n');

  return `${head}\r\n${body}`;
}

function toRawBase64Url(rfc2822) {
  const bytes = new TextEncoder().encode(rfc2822);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendViaResend(env, { from, to, subject, html, text }) {
  const key = env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY not configured');
  const body = { from, to: [to], subject };
  if (html) body.html = html;
  if (text) body.text = text;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${t.slice(0, 400)}`);
  }
  const json = await res.json().catch(() => ({}));
  const id = json?.id != null ? String(json.id).trim() : '';
  if (!id) {
    throw new Error('Resend returned ok but no message id');
  }
  return { provider: 'resend', id };
}

async function sendViaGmail(env, { from, to, subject, html, text }) {
  const token = await getGmailSendAccessToken(env);
  const rfc = buildRfc2822({ from, to, subject, html: html || '', text });
  const raw = toRawBase64Url(rfc);
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Gmail API ${res.status}: ${t.slice(0, 400)}`);
  }
  const data = await res.json().catch(() => ({}));
  return { provider: 'gmail', id: data.id };
}

export async function handleEmailApi(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  if (!isEmailSendAuthorized(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const to = body?.to != null ? String(body.to).trim() : '';
  const subject = body?.subject != null ? String(body.subject) : '';
  const html = body?.html != null ? String(body.html) : '';
  const text = body?.text != null ? String(body.text) : '';

  if (!to || !subject || (!html && !text)) {
    return jsonResponse(
      { error: 'message required', detail: 'Provide to, subject, and html and/or text' },
      400,
    );
  }

  const from =
    (body?.from != null && String(body.from).trim()) ||
    env.RESEND_FROM ||
    env.GMAIL_FROM ||
    '';
  if (!from) {
    return jsonResponse({ error: 'from required', detail: 'Set RESEND_FROM or provide from in body' }, 400);
  }
  // Safety: block self-send unless explicitly allowed (used only for self-tests).
  const allowSelf =
    String(env.ALLOW_SELF_SEND_EMAILS || '').trim().toLowerCase() === 'true' ||
    String(env.ALLOW_SELF_SEND_EMAILS || '').trim() === '1';
  const extractFromEmail = (v) => {
    const s = String(v || '').trim();
    const m = /<([^>]+)>/.exec(s);
    return (m && m[1] ? m[1] : s).trim().toLowerCase();
  };
  if (!allowSelf) {
    const fromEmail = extractFromEmail(from);
    if (fromEmail && to.toLowerCase() === fromEmail) {
      return jsonResponse({ error: 'self_send_blocked' }, 400);
    }
  }

  try {
    const out = await sendViaResend(env, { from, to, subject, html, text });
    const { resolveUserIdByEmail, logAndArchiveSentEmail } = await import('../../backend/services/email/email-sent-archive.js');
    const userId = await resolveUserIdByEmail(env, to);
    await logAndArchiveSentEmail(env, {
      to,
      from,
      subject,
      html,
      text,
      status: 'sent',
      provider: 'resend',
      externalMessageId: out.id,
      userId,
    }).catch((e) => console.warn('[email/send] archive', e?.message ?? e));

    // Optional deploy trail receipt when caller passes deployment_id.
    const deploymentId =
      body?.deployment_id != null
        ? String(body.deployment_id).trim()
        : body?.deploymentId != null
          ? String(body.deploymentId).trim()
          : '';
    if (deploymentId && env.DB) {
      try {
        const { recordPhoneLoopDeploymentNotification } = await import(
          '../core/email-agent-bridge.js'
        );
        await recordPhoneLoopDeploymentNotification(env, {
          deploymentId,
          recipient: to,
          subject,
          message: text || html?.slice(0, 4000) || null,
          status: 'sent',
          resendMessageId: out.id,
          notificationType: 'deploy_email',
        });
      } catch (e) {
        console.warn('[email/send] deployment_notifications', e?.message ?? e);
      }
    }

    return jsonResponse({ ok: true, provider: 'resend', id: out.id, resend_id: out.id });
  } catch (resendErr) {
    console.warn('[email/send] Resend failed, trying Gmail:', resendErr?.message ?? resendErr);
    try {
      const out = await sendViaGmail(env, { from, to, subject, html, text });
    const { resolveUserIdByEmail, logAndArchiveSentEmail } = await import('../../backend/services/email/email-sent-archive.js');
      const userId = await resolveUserIdByEmail(env, to);
      await logAndArchiveSentEmail(env, {
        to,
        from,
        subject,
        html,
        text,
        status: 'sent',
        provider: 'gmail',
        externalMessageId: out.id ?? null,
        userId,
      }).catch((e) => console.warn('[email/send] archive', e?.message ?? e));
      return jsonResponse({
        ok: true,
        ...out,
        resend_error: String(resendErr?.message || resendErr),
      });
    } catch (gmailErr) {
      console.warn('[email/send] Gmail failed:', gmailErr?.message ?? gmailErr);
      return jsonResponse(
        {
          error: 'Send failed',
          resend_error: String(resendErr?.message || resendErr),
          gmail_error: String(gmailErr?.message || gmailErr),
        },
        502,
      );
    }
  }
}
