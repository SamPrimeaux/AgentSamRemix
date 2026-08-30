/**
 * CloudConvert inbound webhooks — job.created / job.finished / job.failed
 * POST /api/webhooks/cloudconvert
 */
import { jsonResponse } from '../../core/auth.js';
import { ingestWebhookEventAndDispatch } from '../../../backend/services/webhooks/ingest.js';
import { verifyCloudConvertWebhookSignature } from '../../core/cloudconvert-webhook-verify.js';
import { applyCloudConvertWebhookToMoviemode } from '../../core/moviemode-cloudconvert-webhook.js';

const LOGICAL_PROVIDER = 'cloudconvert';

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function handleCloudConvertWebhook(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const raw = await request.text();
  const secret = String(env?.CLOUDCONVERT_WEBHOOK_SECRET || '').trim();
  const sigHeader = request.headers.get('CloudConvert-Signature') || '';
  let signatureValid = false;

  if (secret) {
    const verified = await verifyCloudConvertWebhookSignature(secret, sigHeader, raw);
    if (!verified.ok) {
      return jsonResponse({ error: 'invalid_signature', reason: verified.reason }, 401);
    }
    signatureValid = true;
  } else {
    console.warn('[cloudconvert-webhook] CLOUDCONVERT_WEBHOOK_SECRET not set — accepting unsigned');
  }

  /** @type {Record<string, unknown>} */
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const eventType = String(payload?.event || 'job.unknown').trim();
  const jobId =
    payload?.job && typeof payload.job === 'object' && payload.job !== null && 'id' in payload.job
      ? String(/** @type {any} */ (payload.job).id)
      : null;

  const ingest = await ingestWebhookEventAndDispatch(env, ctx, {
    tenantId: null,
    workspaceId: null,
    provider: LOGICAL_PROVIDER,
    eventType,
    eventId: jobId,
    payload,
    endpointPath: '/api/webhooks/cloudconvert',
    signatureValid,
  });

  const moviemode = await applyCloudConvertWebhookToMoviemode(env, ctx, payload);

  return jsonResponse({
    ok: true,
    ingest: ingest?.ok ?? false,
    event_type: eventType,
    moviemode,
  });
}
