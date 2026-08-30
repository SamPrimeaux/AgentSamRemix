/**
 * RealtimeKit inbound webhooks — dyte-signature (RSA) + REALTIMEKIT_WEBHOOK_SECRET (smoke).
 * POST /api/webhooks/realtimekit
 */
import { jsonResponse } from '../../core/auth.js';
import { ingestWebhookEventAndDispatch } from '../../../backend/services/webhooks/ingest.js';
import { processRealtimeKitWebhookPayload } from '../../core/realtimekit-webhook-handler.js';
import {
  verifyRealtimeKitDyteSignature,
  verifyRealtimeKitWebhookSecret,
} from '../../core/realtimekit-webhook-verify.js';

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function handleRealtimeKitWebhook(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const raw = await request.text();
  /** @type {Record<string, unknown>} */
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const dyteSignature = (request.headers.get('dyte-signature') || '').trim();
  const dyteUuid = (request.headers.get('dyte-uuid') || '').trim() || null;
  const hasSecret =
    env?.REALTIMEKIT_WEBHOOK_SECRET != null &&
    String(env.REALTIMEKIT_WEBHOOK_SECRET).trim() !== '';

  let signatureValid = false;
  if (dyteSignature) {
    signatureValid = await verifyRealtimeKitDyteSignature(env, dyteSignature, payload);
    if (!signatureValid) {
      return jsonResponse({ error: 'invalid_dyte_signature' }, 401);
    }
  } else if (hasSecret) {
    if (!verifyRealtimeKitWebhookSecret(env, request)) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }
    signatureValid = true;
  } else {
    return jsonResponse({ error: 'REALTIMEKIT_WEBHOOK_SECRET not configured' }, 503);
  }

  const eventType = String(payload?.event || payload?.type || 'unknown').trim();

  const ingestPromise = ingestWebhookEventAndDispatch(env, ctx, {
    tenantId: null,
    workspaceId: null,
    provider: 'realtimekit',
    eventType,
    payload,
    endpointPath: '/api/webhooks/realtimekit',
    signatureValid,
  });

  const meetPromise = processRealtimeKitWebhookPayload(env, payload, dyteUuid);

  const [ingest, meet] = await Promise.all([ingestPromise, meetPromise]);

  return jsonResponse({
    ok: true,
    event: eventType,
    ingest: ingest?.ok ?? false,
    meet,
  });
}
