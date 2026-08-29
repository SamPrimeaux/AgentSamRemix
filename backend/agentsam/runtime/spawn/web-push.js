// guard-dup-allow: backend spawn peel; shared notification callers migrate separately.
/** Web Push notification seam for spawn budget warnings. */

import { sendNotification } from 'web-push-neo';

function configured(env) {
  return Boolean(
    env?.VAPID_PUBLIC_KEY &&
      env?.VAPID_PRIVATE_KEY &&
      env?.VAPID_SUBJECT,
  );
}

export async function sendWebPushToUser(env, payload = {}) {
  if (!configured(env) || !env?.DB) return { ok: false, sent: 0, reason: 'vapid_not_configured' };
  const userId = String(payload.userId || '').trim();
  if (!userId) return { ok: false, sent: 0, reason: 'no_user' };
  const { readNotificationPrefs } = await import('../../../identity/notification-prefs.js');
  const prefs = await readNotificationPrefs(env, userId).catch(() => null);
  if (prefs && prefs.channels?.push !== true) return { ok: true, sent: 0, reason: 'push_disabled' };
  const rows = await env.DB.prepare(
    `SELECT handler_config FROM agentsam_hook
      WHERE handler_type = 'web_push' AND COALESCE(is_active, 1) = 1
        AND target_id = ?`,
  ).bind(userId).all().catch(() => ({ results: [] }));
  let sent = 0;
  for (const row of rows.results || []) {
    let subscription;
    try {
      subscription = typeof row.handler_config === 'string'
        ? JSON.parse(row.handler_config)
        : row.handler_config || {};
    } catch {
      continue;
    }
    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) continue;
    try {
      const result = await sendNotification(subscription, JSON.stringify({
        title: payload.title || 'Inner Animal Media',
        body: payload.body || '',
        url: payload.url || '/dashboard/agent',
        tag: payload.tag || 'iam',
      }), {
        vapidDetails: {
          subject: String(env.VAPID_SUBJECT).trim(),
          publicKey: String(env.VAPID_PUBLIC_KEY).trim(),
          privateKey: String(env.VAPID_PRIVATE_KEY).trim(),
        },
      });
      if ([200, 201, 204].includes(Number(result?.statusCode))) sent += 1;
    } catch {
      /* A push failure must not fail the lane budget halt. */
    }
  }
  return { ok: true, sent };
}
