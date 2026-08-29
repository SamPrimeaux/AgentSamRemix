/**
 * Archive sent email bodies for /dashboard/mail Sent folder.
 */
import { insertEmailLog } from './email-log.js';
import { emailSentLogKey, getEmailR2Bucket } from './r2-email.js';

/**
 * @param {any} env
 * @param {string} email
 */
export async function resolveUserIdByEmail(env, email) {
  const addr = String(email || '').trim().toLowerCase();
  if (!addr || !env?.DB) return null;
  const row = await env.DB.prepare(
    `SELECT id FROM auth_users WHERE lower(trim(email)) = ? LIMIT 1`,
  )
    .bind(addr)
    .first()
    .catch(() => null);
  return row?.id ? String(row.id) : null;
}

/**
 * @param {any} env
 * @param {{
 *   to: string,
 *   from: string,
 *   subject: string,
 *   html?: string|null,
 *   text?: string|null,
 *   status?: string,
 *   externalMessageId?: string|null,
 *   provider?: string|null,
 *   userId?: string|null,
 *   tenantId?: string|null,
 *   logId?: string|null,
 * }} opts
 */
export async function logAndArchiveSentEmail(env, opts) {
  if (!env?.DB) return { ok: false, reason: 'no_db' };
  const logId = opts.logId || crypto.randomUUID();
  const text =
    opts.text != null && String(opts.text).trim()
      ? String(opts.text).trim()
      : opts.html
        ? String(opts.html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50000)
        : null;

  let userId = opts.userId || null;
  if (!userId && opts.to) userId = await resolveUserIdByEmail(env, opts.to);

  await insertEmailLog(env, {
    id: logId,
    to: opts.to,
    from: opts.from,
    subject: opts.subject,
    status: opts.status || 'sent',
    externalMessageId: opts.externalMessageId,
    provider: opts.provider || 'resend',
    userId,
    tenantId: opts.tenantId,
    textContent: text,
  });

  const bucket = getEmailR2Bucket(env);
  if (bucket) {
    try {
      await bucket.put(
        emailSentLogKey(logId),
        JSON.stringify({
          id: logId,
          from: opts.from,
          to: opts.to,
          subject: opts.subject,
          html: opts.html || null,
          text: text,
          sent_at: new Date().toISOString(),
        }),
        { httpMetadata: { contentType: 'application/json' } },
      );
    } catch (e) {
      console.warn('[email-sent-archive] R2 put failed', e?.message ?? e);
    }
  }

  return { ok: true, logId, userId };
}
