/**
 * Core Layer: Notifications — platform email via sendPlatformEmail.
 */

import { sendPlatformEmail } from '../../../../src/lib/email.js';

/**
 * Platform notification + email_logs.
 * Prefer opts.to, else resolve from opts.userId via D1 (user_settings / auth_users).
 * Platform-ops-only fallback: env.RESEND_TO when no user context (cron ops channel).
 * Use executionCtx.waitUntil when provided so the fetch path never blocks.
 * Phone-loop: pass conversationId / inReplyTo when threading a reply.
 */
export async function notifySam(env, opts, executionCtx) {
  const subjectRaw = String(opts.subject || '')
    .replace(/[\r\n\t]/g, ' ')
    .trim();
  const bodyRaw = String(opts.body || '').trim();
  const category = String(opts.category || 'notice').trim();
  let toAddr = opts.to != null ? String(opts.to).trim() : '';
  if (!toAddr && opts.userId) {
    const { resolveNotificationEmail } = await import('../../../identity/notification-prefs.js');
    toAddr = (await resolveNotificationEmail(env, opts.userId)).email;
  }
  if (!toAddr && typeof env.RESEND_TO === 'string') {
    toAddr = env.RESEND_TO.trim();
  }

  return sendPlatformEmail(
    env,
    {
      subject: subjectRaw,
      text: bodyRaw,
      html: opts.html,
      to: toAddr,
      category,
      conversationId: opts.conversationId,
      inReplyTo: opts.inReplyTo,
      from: opts.from,
      noAgentSamPrefix: opts.noAgentSamPrefix,
    },
    executionCtx,
  );
}
