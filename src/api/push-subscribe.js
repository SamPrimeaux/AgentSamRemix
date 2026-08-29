/**
 * Web Push subscription storage via agentsam_hook (handler_type = web_push).
 * POST /api/push/subscribe — session auth required.
 */

import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js'; import { getAuthUser } from '../../backend/identity/index.js';
import { sha256Hex } from '../../packages/shared/crypto/sha256.js';

function newHookId() {
  return `hook_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** agentsam_hook.trigger CHECK — route web push via event_type instead. */
const PUSH_HOOK_TRIGGER = 'start';
const PUSH_HOOK_EVENT_TYPE = 'notification.push';

async function endpointFingerprint(endpoint) {
  const hash = await sha256Hex(endpoint);
  return hash.slice(-16);
}

export async function handlePushSubscribe(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);

  const authUser = await getAuthUser(request, env);
  if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const endpoint = String(body.endpoint || '').trim();
  const keys = body.keys && typeof body.keys === 'object' ? body.keys : {};
  const p256dh = String(keys.p256dh || '').trim();
  const auth = String(keys.auth || '').trim();
  const userAgent =
    typeof body.user_agent === 'string'
      ? body.user_agent.trim()
      : (request.headers.get('User-Agent') || '').trim() || null;

  if (!endpoint || !p256dh || !auth) {
    return jsonResponse({ error: 'Invalid subscription object' }, 400);
  }

  const tenantId = String(authUser.active_tenant_id || authUser.tenant_id || '').trim() || 'unknown';
  const workspaceId = String(authUser.active_workspace_id || '').trim() || null;
  const userId = String(authUser.id);
  const hookKey = `push:${userId}:${await endpointFingerprint(endpoint)}`;

  const handlerConfig = JSON.stringify({
    endpoint,
    keys: { p256dh, auth },
    user_agent: userAgent,
  });

  const existing = await env.DB.prepare(
    `SELECT id FROM agentsam_hook
     WHERE tenant_id = ? AND hook_key = ? AND handler_type = 'web_push'
     LIMIT 1`,
  )
    .bind(tenantId, hookKey)
    .first();

  if (existing?.id) {
    await env.DB.prepare(`
      UPDATE agentsam_hook SET
        handler_config = ?,
        workspace_id = ?,
        user_id = ?,
        target_id = ?,
        event_type = ?,
        is_active = 1,
        updated_at = datetime('now')
      WHERE id = ?
    `)
      .bind(handlerConfig, workspaceId, userId, userId, PUSH_HOOK_EVENT_TYPE, existing.id)
      .run();
  } else {
    const id = newHookId();
    await env.DB.prepare(`
      INSERT INTO agentsam_hook (
        id, tenant_id, workspace_id, user_id, provider, trigger, command,
        target_id, handler_type, handler_config, hook_key, event_type, is_active,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, 'browser', ?, '',
        ?, 'web_push', ?, ?, ?, 1,
        datetime('now'), datetime('now')
      )
    `)
      .bind(
        id,
        tenantId,
        workspaceId,
        userId,
        PUSH_HOOK_TRIGGER,
        userId,
        handlerConfig,
        hookKey,
        PUSH_HOOK_EVENT_TYPE,
      )
      .run();
  }

  return jsonResponse({ ok: true, hook_key: hookKey });
}

export async function handlePushVapidPublicKey(request, env) {
  const authUser = await getAuthUser(request, env);
  if (!authUser?.id) return jsonResponse({ error: 'Unauthorized', code: 'SESSION_MISSING' }, 401);

  const key = env?.VAPID_PUBLIC_KEY && String(env.VAPID_PUBLIC_KEY).trim();
  if (!key) return jsonResponse({ error: 'Web Push not configured' }, 503);
  return jsonResponse({ publicKey: key });
}

function isPushNotifyAuthorized(request, env) {
  if (verifyBridgeKey(request, env)) return true;
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const pushToken = env?.PUSH_SERVICE_TOKEN != null ? String(env.PUSH_SERVICE_TOKEN).trim() : '';
  if (pushToken && bearer === pushToken) return true;
  const bridge = env?.AGENTSAM_BRIDGE_KEY != null ? String(env.AGENTSAM_BRIDGE_KEY).trim() : '';
  if (bridge && bearer === bridge) return true;
  return false;
}

/**
 * POST /api/push/notify — internal broadcast (deploy CI, automation).
 * Auth: AGENTSAM_BRIDGE_KEY, Bearer PUSH_SERVICE_TOKEN.
 */
export async function handlePushNotify(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  if (!isPushNotifyAuthorized(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const title = String(body.title || 'Inner Animal Media').trim();
  const messageBody = String(body.body ?? body.message ?? '').trim();
  const url = String(body.url || '/dashboard/agent').trim();
  const tag = String(body.tag || 'iam').trim();
  const userId = body.userId != null ? String(body.userId).trim() : '';

  const { sendWebPushToUser, broadcastWebPushToActiveSubscriptions } =
    await import('../../backend/identity/web-push-runtime.js');

  if (userId) {
    const result = await sendWebPushToUser(env, {
      userId,
      tenantId: body.tenantId != null ? String(body.tenantId).trim() : undefined,
      workspaceId: body.workspaceId != null ? String(body.workspaceId).trim() : undefined,
      title,
      body: messageBody,
      url,
      tag,
    });
    return jsonResponse({ ok: true, mode: 'user', ...result });
  }

  const result = await broadcastWebPushToActiveSubscriptions(env, {
    title,
    body: messageBody,
    url,
    tag,
  });
  return jsonResponse({ ok: true, mode: 'broadcast', ...result });
}

export async function handlePushUnsubscribe(request, env) {
  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  if (!env.DB) return jsonResponse({ error: 'Database not configured' }, 503);

  const authUser = await getAuthUser(request, env);
  if (!authUser?.id) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body = {};
  try {
    body = await request.json();
  } catch {
    /* DELETE may have no body */
  }

  const endpoint = String(body.endpoint || '').trim();
  const hookKeyInput = String(body.hook_key || '').trim();
  const tenantId = String(authUser.active_tenant_id || authUser.tenant_id || '').trim() || 'unknown';
  const userId = String(authUser.id);

  let hookKey = hookKeyInput;
  if (!hookKey && endpoint) {
    hookKey = `push:${userId}:${await endpointFingerprint(endpoint)}`;
  }
  if (!hookKey) return jsonResponse({ error: 'endpoint or hook_key required' }, 400);

  await env.DB.prepare(`
    UPDATE agentsam_hook
    SET is_active = 0, updated_at = datetime('now')
    WHERE tenant_id = ? AND hook_key = ? AND user_id = ? AND handler_type = 'web_push'
  `)
    .bind(tenantId, hookKey, userId)
    .run();

  return jsonResponse({ ok: true });
}

/**
 * POST /api/push/action — SW notification button → Agent Sam turn.
 * Auth: sealed HMAC token (minted into the push payload). Session cookie optional.
 */
export async function handlePushAction(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const token = String(body.token || '').trim();
  if (!token) return jsonResponse({ error: 'token required' }, 400);

  const { verifyPushActionToken } = await import('../core/push-action-token.js');
  const verified = await verifyPushActionToken(env, token);
  if (!verified.ok) {
    return jsonResponse({ error: verified.error || 'invalid_token' }, 401);
  }

  const claimedAction = String(body.action || '').trim();
  if (claimedAction && claimedAction !== verified.action) {
    return jsonResponse({ error: 'action_mismatch' }, 400);
  }

  const { runAgentTurnFromPushAction } = await import('../core/email-agent-bridge.js');
  const result = await runAgentTurnFromPushAction(env, ctx || { waitUntil() {} }, {
    conversationId: verified.conversationId,
    instruction: verified.instruction,
    action: verified.action,
  });

  return jsonResponse({
    ok: !!result?.ok || !!result?.accepted,
    accepted: !!result?.accepted,
    conversationId: verified.conversationId,
    action: verified.action,
    error: result?.error,
  });
}
