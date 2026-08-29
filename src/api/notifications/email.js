/**
 * App-level email notifications (not Supabase Auth hook traffic).
 * Uses the backend-owned Resend client.
 */
import { sendResendEmail } from '../../../backend/services/email/resend.js';
import { jsonResponse } from '../../core/responses.js'; import { verifyBridgeKey } from '../../../backend/auth/bridge-key-auth.js';

/**
 * POST /api/notifications/email  (internal)
 * Body: { to, subject, html?, text?, tag? }
 */
export async function handleAppNotificationEmail(request, env) {
  if (!verifyBridgeKey(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  const body = await request.json().catch(() => ({}));
  const to = body.to;
  const subject = body.subject;
  if (!to || !subject) return jsonResponse({ error: 'to and subject required' }, 400);
  const out = await sendResendEmail(env, {
    to,
    subject,
    html: body.html,
    text: body.text,
    tags: body.tag ? [{ name: 'app', value: String(body.tag) }] : undefined,
  });
  if (out.error) return jsonResponse({ ok: false, error: out.error }, 502);
  return jsonResponse({ ok: true, id: out.id });
}
