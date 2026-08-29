/**
 * Cloudflare build/deploy webhooks — INTERNAL_WEBHOOK_SECRET or X-Cf-Webhook-Secret.
 */
import { jsonResponse } from '../../core/auth.js';
import { ingestWebhookEventAndDispatch } from '../../../backend/http/webhooks/ingest.js';
import { resolveInternalWebhookSecret } from './internal.js';

/** @param {string} a @param {string} b */
function timingSafeEqualUtf8(a, b) {
  const enc = new TextEncoder();
  const ea = enc.encode(a);
  const eb = enc.encode(b);
  if (ea.length !== eb.length) return false;
  let d = 0;
  for (let i = 0; i < ea.length; i += 1) d |= ea[i] ^ eb[i];
  return d === 0;
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function handleCloudflareWebhook(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const secret = await resolveInternalWebhookSecret(env);
  const cfHeader = (request.headers.get('X-Cf-Webhook-Secret') || '').trim();
  const auth = (request.headers.get('Authorization') || '').trim();
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  if (secret) {
    const candidate = cfHeader || bearer;
    if (!candidate || !timingSafeEqualUtf8(candidate, secret)) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }
  }

  const raw = await request.text();
  /** @type {Record<string, unknown>} */
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { _raw: raw.slice(0, 8000) };
  }

  const eventType = String(
    payload?.type || payload?.event_type || payload?.status || 'build_event',
  ).trim();
  const nested =
    payload?.payload && typeof payload.payload === 'object'
      ? /** @type {Record<string, unknown>} */ (payload.payload)
      : payload;
  const eventId =
    (nested?.id != null ? String(nested.id) : null) ||
    (payload?.id != null ? String(payload.id) : null);
  const { extractGithubRepoFromWebhookPayload, extractWorkerNameFromWebhookPayload } = await import('../../../backend/services/webhooks/ledger.js');
  const repoFullName = extractGithubRepoFromWebhookPayload(payload, null);
  const workerName = extractWorkerNameFromWebhookPayload(payload, null);
  const metadata = {
    ...(repoFullName ? { repo_full_name: repoFullName } : {}),
    ...(workerName ? { worker_name: workerName } : {}),
  };
  await ingestWebhookEventAndDispatch(env, ctx, {
    tenantId: null,
    workspaceId: null,
    provider: 'cloudflare',
    eventType,
    eventId,
    payload,
    metadata: Object.keys(metadata).length ? metadata : null,
    endpointPath: '/api/webhooks/cloudflare',
    signatureValid: Boolean(secret),
  });

  return jsonResponse({ ok: true });
}
