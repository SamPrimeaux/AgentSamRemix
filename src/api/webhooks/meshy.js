/**
 * Meshy task webhooks — POST /api/webhooks/meshy
 * Payload is the Meshy task object (text/image-to-3d status updates).
 */
import { jsonResponse } from '../../core/auth.js';
import { applyMeshyTaskToCadJob, meshyTaskIdFromPayload, meshyTaskStatus } from '../../core/meshy-cad-sync.js';
import { verifyMeshyWebhookRequest } from '../../core/meshy-webhook-verify.js';
import { ingestWebhookEventAndDispatch } from '../../../backend/services/webhooks/ingest.js';

const LOGICAL_PROVIDER = 'meshy';

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function handleMeshyWebhook(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const raw = await request.text();
  const verified = await verifyMeshyWebhookRequest(request, env, raw);

  /** @type {Record<string, unknown>} */
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const taskId = meshyTaskIdFromPayload(payload);
  const taskStatus = meshyTaskStatus(payload);
  const eventType = taskStatus ? `task.${taskStatus.toLowerCase()}` : 'task.unknown';

  const ingest = await ingestWebhookEventAndDispatch(env, ctx, {
    tenantId: null,
    workspaceId: null,
    provider: LOGICAL_PROVIDER,
    eventType,
    eventId: taskId,
    payload,
    endpointPath: '/api/webhooks/meshy',
    signatureValid: verified.verified === true,
  });

  let cad = { ok: false, skipped: true };
  try {
    cad = await applyMeshyTaskToCadJob(env, ctx, payload);
  } catch (e) {
    console.warn('[meshy-webhook] cad apply failed:', e?.message ?? e);
    cad = { ok: false, error: e?.message ?? String(e) };
  }

  if (!verified.ok) {
    return jsonResponse({ error: 'unauthorized', reason: verified.reason }, 401);
  }

  return jsonResponse({
    ok: true,
    ingest: ingest?.ok ?? false,
    event_type: eventType,
    external_task_id: taskId,
    signature_verified: verified.verified === true,
    cad,
  });
}
