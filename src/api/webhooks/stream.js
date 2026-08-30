/**
 * Cloudflare Stream webhooks — VOD (Webhook-Signature) + Live Input (cf-webhook-auth).
 * POST /api/webhooks/stream/vod
 * POST /api/webhooks/stream/live
 */
import { jsonResponse } from '../../core/auth.js';
import { ingestWebhookEventAndDispatch } from '../../../backend/services/webhooks/ingest.js';
import {
  verifyCfNotificationWebhookSecret,
  verifyStreamVodWebhookSignature,
} from '../../core/stream-webhook-verify.js';
import {
  applyStreamLiveWebhookToMoviemode,
  applyStreamVodWebhookToMoviemode,
} from '../../../backend/services/media/moviemode-live-inputs.js';

const LOGICAL_PROVIDER = 'stream';

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function handleStreamVodWebhook(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const raw = await request.text();
  const secret = String(env?.CLOUDFLARE_STREAM_WEBHOOK_SECRET || '').trim();
  const sigHeader = request.headers.get('Webhook-Signature') || '';
  let signatureValid = false;

  if (secret) {
    const verified = await verifyStreamVodWebhookSignature(secret, sigHeader, raw);
    if (!verified.ok) {
      return jsonResponse({ error: 'invalid_signature', reason: verified.reason }, 401);
    }
    signatureValid = true;
  } else {
    console.warn('[stream-vod-webhook] CLOUDFLARE_STREAM_WEBHOOK_SECRET not set — accepting unsigned');
  }

  /** @type {Record<string, unknown>} */
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const state = String(/** @type {any} */ (payload)?.status?.state || '').trim();
  const eventType =
    state === 'error' ? 'video.error' : payload?.readyToStream ? 'video.ready' : 'video.processing';

  const ingest = await ingestWebhookEventAndDispatch(env, ctx, {
    tenantId: null,
    workspaceId: null,
    provider: LOGICAL_PROVIDER,
    eventType,
    eventId: payload?.uid != null ? String(payload.uid) : null,
    payload,
    endpointPath: '/api/webhooks/stream/vod',
    signatureValid,
  });

  const moviemode = await applyStreamVodWebhookToMoviemode(env, ctx, payload);

  return jsonResponse({
    ok: true,
    ingest: ingest?.ok ?? false,
    event_type: eventType,
    moviemode,
  });
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function handleStreamLiveWebhook(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const secret = String(
    env?.CLOUDFLARE_STREAM_LIVE_WEBHOOK_SECRET || env?.INTERNAL_WEBHOOK_SECRET || '',
  ).trim();
  const cfAuth = request.headers.get('cf-webhook-auth');
  let signatureValid = false;

  if (secret) {
    const verified = verifyCfNotificationWebhookSecret(secret, cfAuth);
    if (!verified.ok) {
      return jsonResponse({ error: 'unauthorized', reason: verified.reason }, 401);
    }
    signatureValid = true;
  } else {
    console.warn('[stream-live-webhook] CLOUDFLARE_STREAM_LIVE_WEBHOOK_SECRET not set — accepting unsigned');
  }

  const raw = await request.text();
  /** @type {Record<string, unknown>} */
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const data = /** @type {any} */ (payload?.data || payload);
  const eventType = String(data?.event_type || data?.eventType || 'live_input.unknown').trim();

  const ingest = await ingestWebhookEventAndDispatch(env, ctx, {
    tenantId: null,
    workspaceId: null,
    provider: LOGICAL_PROVIDER,
    eventType,
    eventId: data?.input_id != null ? String(data.input_id) : null,
    payload,
    endpointPath: '/api/webhooks/stream/live',
    signatureValid,
  });

  const moviemode = await applyStreamLiveWebhookToMoviemode(env, payload);

  return jsonResponse({
    ok: true,
    ingest: ingest?.ok ?? false,
    event_type: eventType,
    moviemode,
  });
}
