/**
 * Web Push delivery via agentsam_hook (handler_type = web_push).
 * Requires VAPID keys on the Worker: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
 */

import { sendNotification } from 'web-push-neo';

function vapidConfigured(env) {
  return !!(
    env?.VAPID_PUBLIC_KEY &&
    env?.VAPID_PRIVATE_KEY &&
    String(env.VAPID_PRIVATE_KEY).trim() &&
    env?.VAPID_SUBJECT &&
    String(env.VAPID_SUBJECT).trim()
  );
}

function vapidDetails(env) {
  return {
    subject: String(env.VAPID_SUBJECT).trim(),
    publicKey: String(env.VAPID_PUBLIC_KEY).trim(),
    privateKey: String(env.VAPID_PRIVATE_KEY).trim(),
  };
}

/**
 * @param {*} env
 * @param {{ endpoint: string, keys: { p256dh: string, auth: string } }} subscription
 * @param {{ title?: string, body?: string, url?: string, tag?: string, notificationId?: string, entityType?: string, entityId?: string, actions?: Array<{action: string, title: string}>, actionTokens?: Record<string, string> }} message
 */
export async function sendWebPushFromSubscription(env, subscription, message = {}) {
  if (!vapidConfigured(env)) {
    return { ok: false, reason: 'vapid_not_configured' };
  }

  const endpoint = String(subscription?.endpoint || '').trim();
  const p256dh = String(subscription?.keys?.p256dh || '').trim();
  const auth = String(subscription?.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !auth) {
    return { ok: false, reason: 'invalid_subscription' };
  }

  const actions = Array.isArray(message.actions)
    ? message.actions
        .filter((a) => a && a.action && a.title)
        .slice(0, 2)
        .map((a) => ({ action: String(a.action).slice(0, 32), title: String(a.title).slice(0, 40) }))
    : [];
  const actionTokens =
    message.actionTokens && typeof message.actionTokens === 'object' ? message.actionTokens : {};

  const payload = JSON.stringify({
    title: message.title || 'Inner Animal Media',
    body: message.body || '',
    url: message.url || '/dashboard/agent',
    tag: message.tag || 'iam',
    notificationId: message.notificationId || null,
    entityType: message.entityType || null,
    entityId: message.entityId || null,
    actions,
    actionTokens,
  });

  try {
    const result = await sendNotification(
      { endpoint, keys: { p256dh, auth } },
      payload,
      { vapidDetails: vapidDetails(env) },
    );
    if (result?.statusCode === 201 || result?.statusCode === 200 || result?.statusCode === 204) {
      return { ok: true, status: result.statusCode };
    }
    return {
      ok: false,
      status: result?.statusCode,
      reason: 'push_service_error',
      error: result?.body?.slice?.(0, 200) ?? '',
    };
  } catch (e) {
    return { ok: false, reason: 'send_failed', error: e?.message ?? String(e) };
  }
}

/**
 * @param {*} env
 * @param {{ userId?: string, workspaceId?: string, tenantId?: string, title: string, body: string, url?: string, tag?: string, notificationId?: string, entityType?: string, entityId?: string }} payload
 */
export async function sendWebPushToUser(env, payload) {
  if (!vapidConfigured(env) || !env.DB) {
    return { ok: false, reason: 'vapid_not_configured', sent: 0 };
  }

  const userId = String(payload.userId || '').trim();
  if (!userId) return { ok: false, reason: 'no_user', sent: 0 };

  const tenantId = payload.tenantId ? String(payload.tenantId).trim() : null;
  const workspaceId = payload.workspaceId ? String(payload.workspaceId).trim() : null;

  let query = `
    SELECT handler_config FROM agentsam_hook
    WHERE handler_type = 'web_push'
      AND is_active = 1
      AND target_id = ?
  `;
  const binds = [userId];
  if (tenantId) {
    query += ` AND tenant_id = ?`;
    binds.push(tenantId);
  }
  if (workspaceId) {
    query += ` AND (workspace_id IS NULL OR workspace_id = ?)`;
    binds.push(workspaceId);
  }

  const { results } = await env.DB.prepare(query).bind(...binds).all().catch(() => ({ results: [] }));
  const rows = Array.isArray(results) ? results : [];
  if (!rows.length) return { ok: true, sent: 0, reason: 'no_subscriptions' };

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    let cfg = {};
    try {
      cfg = typeof row.handler_config === 'string' ? JSON.parse(row.handler_config) : row.handler_config || {};
    } catch {
      continue;
    }
    const result = await sendWebPushFromSubscription(env, cfg, payload);
    if (result.ok) sent += 1;
    else failed += 1;
  }

  return { ok: true, sent, failed };
}

/**
 * Send a push notification to every active web_push agentsam_hook subscription.
 * Used after deploy:full (post-deploy handler) and POST /api/push/notify.
 *
 * @param {*} env
 * @param {{ title?: string, body?: string, url?: string, tag?: string }} message
 */
export async function broadcastWebPushToActiveSubscriptions(env, message = {}) {
  if (!vapidConfigured(env) || !env.DB) {
    return { ok: false, reason: 'vapid_not_configured', sent: 0, failed: 0, total: 0 };
  }

  const { results } = await env.DB.prepare(`
    SELECT handler_config, target_id, hook_key
    FROM agentsam_hook
    WHERE handler_type = 'web_push' AND is_active = 1
  `)
    .all()
    .catch(() => ({ results: [] }));

  const rows = Array.isArray(results) ? results : [];
  if (!rows.length) return { ok: true, sent: 0, failed: 0, total: 0, reason: 'no_subscriptions' };

  let sent = 0;
  let failed = 0;
  const staleHookKeys = [];
  for (const row of rows) {
    let cfg = {};
    try {
      cfg = typeof row.handler_config === 'string' ? JSON.parse(row.handler_config) : row.handler_config || {};
    } catch {
      failed += 1;
      continue;
    }
    const endpoint = String(cfg?.endpoint || '');
    // Skip known smoke/fixture endpoints so broadcast stats stay honest.
    if (endpoint.includes('smoke-test-endpoint')) {
      failed += 1;
      if (row.hook_key) staleHookKeys.push(String(row.hook_key));
      continue;
    }
    const result = await sendWebPushFromSubscription(env, cfg, message);
    if (result.ok) sent += 1;
    else {
      failed += 1;
      // Gone / expired / invalid → deactivate so deploys and hook fan-out stop thrashing.
      if (
        row.hook_key &&
        (result.status === 404 ||
          result.status === 410 ||
          result.status === 403 ||
          result.reason === 'send_failed' ||
          result.reason === 'push_service_error' ||
          result.reason === 'invalid_subscription')
      ) {
        staleHookKeys.push(String(row.hook_key));
      }
    }
  }

  if (staleHookKeys.length && env.DB) {
    const uniq = [...new Set(staleHookKeys)].slice(0, 50);
    for (const hk of uniq) {
      await env.DB.prepare(
        `UPDATE agentsam_hook SET is_active = 0, updated_at = unixepoch()
          WHERE hook_key = ? AND handler_type = 'web_push'`,
      )
        .bind(hk)
        .run()
        .catch(() => {});
    }
  }

  return { ok: true, sent, failed, total: rows.length, deactivated: staleHookKeys.length };
}

/**
 * @param {*} env
 * @param {{ workspaceId?: string, actorUserId?: string, type: string, entityType?: string, entityId?: string, metadata?: Record<string, unknown> }} evt
 */
export async function recordEvent(env, evt) {
  if (!env?.DB) return null;
  const id = `evt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await env.DB.prepare(`
    INSERT INTO events (id, workspace_id, actor_user_id, type, entity_type, entity_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `)
    .bind(
      id,
      evt.workspaceId ?? null,
      evt.actorUserId ?? null,
      evt.type,
      evt.entityType ?? null,
      evt.entityId ?? null,
      JSON.stringify(evt.metadata ?? {}).slice(0, 4096),
    )
    .run()
    .catch((e) => console.warn('[recordEvent]', e?.message));
  return id;
}

/**
 * @param {*} env
 * @param {{ recipientId: string, channel?: string, subject?: string, message?: string, entityType?: string, entityId?: string, status?: string, data?: Record<string, unknown> }} n
 */
export async function insertPushNotification(env, n) {
  if (!env?.DB) return null;
  const id = `notif_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`
    INSERT INTO notifications (
      id, recipient_id, recipient_type, channel, subject, message, data,
      entity_type, entity_id, priority, status, sent_at, created_at
    ) VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?)
  `)
    .bind(
      id,
      n.recipientId,
      n.channel || 'push',
      n.subject || '',
      n.message || '',
      n.data ? JSON.stringify(n.data).slice(0, 4096) : null,
      n.entityType ?? null,
      n.entityId ?? null,
      n.status || 'sent',
      n.status === 'sent' ? now : null,
      now,
    )
    .run()
    .catch((e) => console.warn('[insertPushNotification]', e?.message));
  return id;
}

/**
 * Record event + deliver a real PWA Web Push to the user.
 *
 * PWA subscriptions are stored as agentsam_hook.event_type = 'notification.push'.
 * Domain event types (code_index.completed, approval.pending_timeout, …) are kept on
 * the events row / optional non-push hooks — delivery always goes through the user's
 * web_push subscription rows via sendWebPushToUser (not event_type match).
 */
export async function notifyUserInAppAndPush(env, ctx, opts) {
  const {
    tenantId,
    userId,
    workspaceId,
    eventType = 'notification.push',
    subject,
    bodyText,
    entityType,
    entityId,
    payloadJson = {},
  } = opts;

  if (!userId) return { ok: false, reason: 'no_user' };

  await recordEvent(env, {
    workspaceId,
    actorUserId: userId,
    type: eventType,
    entityType,
    entityId,
    metadata: { subject, message: bodyText, ...payloadJson },
  });

  const title = subject || 'Inner Animal Media';
  const body = bodyText || '';
  const url = payloadJson?.url || '/dashboard/agent';
  const tag = payloadJson?.tag || eventType || 'iam';

  // Direct delivery — does not depend on hook.event_type matching the domain event.
  const push = await sendWebPushToUser(env, {
    userId,
    tenantId: tenantId || undefined,
    title,
    body,
    url,
    tag,
    entityType: entityType || undefined,
    entityId: entityId || undefined,
  });

  await insertPushNotification(env, {
    recipientId: userId,
    channel: 'push',
    subject: title,
    message: body,
    entityType: entityType ?? null,
    entityId: entityId ?? null,
    status: push?.sent > 0 ? 'sent' : 'queued',
    data: {
      url,
      tag,
      source_event: eventType,
      push_sent: push?.sent ?? 0,
      push_reason: push?.reason ?? null,
    },
  });

  // Hook fanout is domain-owned. This notification service records the event and
  // delivers the user's push subscription only; AgentSam/workflow callers that need
  // non-push hooks must dispatch them explicitly from their own domain boundary.

  return { ok: true, eventType, push };
}
