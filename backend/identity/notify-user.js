/**
 * User-scoped platform email. Recipient is the user's D1 profile email —
 * never env.RESEND_TO (that is the operator/notifySam path).
 */
import { resolveNotificationEmail } from './notification-prefs.js';

/**
 * @param {any} env
 * @param {{
 *   userId?: string,
 *   tenantId?: string,
 *   to?: string,
 *   subject: string,
 *   body?: string,
 *   text?: string,
 *   html?: string,
 *   category?: string,
 *   noAgentSamPrefix?: boolean,
 * }} opts
 * @param {ExecutionContext | null} [executionCtx]
 * @returns {Promise<{ success: boolean, error?: string, async?: boolean, skipped?: boolean, source?: string, data?: unknown }>}
 */
export async function notifyUser(env, opts = {}, executionCtx = null) {
  const subjectRaw = String(opts.subject || '')
    .replace(/[\r\n\t]/g, ' ')
    .trim();
  const bodyRaw = String(opts.body || opts.text || '').trim();
  const category = String(opts.category || 'notice').trim();
  const userId = opts.userId != null ? String(opts.userId).trim() : '';
  const tenantId = opts.tenantId != null ? String(opts.tenantId).trim() : '';
  let toAddr = opts.to != null ? String(opts.to).trim() : '';
  let source = '';
  let prefs = null;

  if (userId) {
    const { readNotificationPrefs } = await import('./notification-prefs.js');
    prefs = await readNotificationPrefs(env, userId).catch(() => null);
  }
  const emailEnabled = !prefs || prefs.channels?.email === true;
  const imessageEnabled = prefs?.channels?.imessage === true;
  const channelResults = {};

  if (emailEnabled) {
    if (!toAddr) {
      if (!userId) return { success: false, error: 'user_id_required' };
      const resolved = await resolveNotificationEmail(env, userId);
      toAddr = resolved.email;
      source = resolved.source;
    } else {
      source = userId ? 'explicit' : 'explicit_no_user';
    }
    if (!toAddr.includes('@')) return { success: false, error: 'notification_email_required' };
  } else {
    source = 'preference';
  }

  if (imessageEnabled) {
    const { enqueueImessageNotification } = await import('./imessage-notify.js');
    channelResults.imessage = await enqueueImessageNotification(env, {
      tenantId,
      workspaceId: opts.workspaceId,
      userId,
      text: `${subjectRaw}\n\n${bodyRaw}`.trim(),
      to: opts.imessageHandle,
    });
  }
  if (prefs?.channels?.push === true && userId) {
    const { sendIdentityWebPushToUser } = await import('./web-push.js');
    channelResults.push = await sendIdentityWebPushToUser(env, {
      userId,
      tenantId,
      workspaceId: opts.workspaceId,
      title: subjectRaw || 'Inner Animal Media',
      body: bodyRaw,
      url: opts.url,
      tag: opts.tag || category,
    });
  }
  if (!emailEnabled && !imessageEnabled && prefs?.channels?.push !== true) {
    return {
      success: true,
      skipped: true,
      source: 'preference',
      data: { channels: channelResults, reason: 'all_channels_disabled' },
    };
  }
  if (!emailEnabled) {
    return {
      success: true,
      skipped: true,
      source: 'preference',
      data: { channels: channelResults, email: 'disabled' },
    };
  }

  const fromAddr =
    typeof env.RESEND_FROM === 'string' && env.RESEND_FROM.trim() ? env.RESEND_FROM.trim() : '';
  const apiKey = env.RESEND_API_KEY != null ? String(env.RESEND_API_KEY).trim() : '';
  if (!fromAddr) return { success: false, error: 'no_from' };
  if (!apiKey) return { success: false, error: 'no_resend_key' };

  const noPrefix = opts.noAgentSamPrefix === true;
  const prefix = noPrefix || subjectRaw.startsWith('[Agent Sam]') ? '' : '[Agent Sam] ';
  const subject = `${prefix}${subjectRaw}`.slice(0, 400);
  const run = async () => {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddr,
          to: [toAddr],
          subject,
          text: bodyRaw,
          ...(opts.html ? { html: String(opts.html) } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (env?.DB) {
        const id = crypto.randomUUID();
        const ext = json.id != null ? String(json.id).trim() : '';
        await env.DB.prepare(
          `INSERT INTO email_logs (
             id, to_email, from_email, subject, status,
             external_message_id, provider, resend_id,
             text_content, user_id, tenant_id, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        )
          .bind(
            id,
            toAddr,
            fromAddr,
            subject,
            res.ok ? 'sent' : 'failed',
            ext || null,
            'resend',
            ext || null,
            bodyRaw || null,
            userId || null,
            tenantId || null,
          )
          .run()
          .catch((e) => console.warn('[notifyUser] email_logs', e?.message ?? e));
      }
      if (!res.ok) {
        console.warn('[notifyUser] Resend', category, res.status, JSON.stringify(json).slice(0, 400));
        return { success: false, error: json?.message || `resend_${res.status}`, source };
      }
      return { success: true, data: { ...json, channels: channelResults }, source };
    } catch (e) {
      console.warn('[notifyUser]', e?.message ?? e);
      return { success: false, error: e?.message ?? String(e) };
    }
  };

  if (executionCtx && typeof executionCtx.waitUntil === 'function') {
    executionCtx.waitUntil(run());
    return { success: true, async: true, source };
  }
  return run();
}
