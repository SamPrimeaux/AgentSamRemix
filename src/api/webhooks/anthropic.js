/**
 * Anthropic Managed Agents inbound webhooks — signature verification + D1 audit row.
 * @see https://platform.claude.com/docs/en/managed-agents/webhooks
 */
import { jsonResponse } from '../../core/auth.js';
import { getVaultSecrets, secretFromVault } from '../../core/vault.js';
import { verifyAnthropicWebhookSignature } from '../../core/anthropic-webhook-verify.js';
import { ingestWebhookEventAndDispatch } from '../../../backend/http/webhooks/ingest.js';

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function handleAnthropicWebhook(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let signingSecret = env.ANTHROPIC_WEBHOOK_SIGNING_KEY;
  if (!signingSecret && env.DB && env.VAULT_KEY) {
    try {
      const vault = await getVaultSecrets(env);
      signingSecret = secretFromVault(vault, env, 'ANTHROPIC_WEBHOOK_SIGNING_KEY');
    } catch {
      /* vault unavailable */
    }
  }
  if (!signingSecret || !String(signingSecret).trim()) {
    return jsonResponse({ error: 'Anthropic webhook signing secret not configured' }, 503);
  }

  const rawBody = await request.text();
  const sig =
    request.headers.get('x-webhook-signature') ??
    request.headers.get('X-Webhook-Signature') ??
    '';

  const ok = await verifyAnthropicWebhookSignature(rawBody, sig, String(signingSecret).trim(), {
    toleranceSec: 300,
  });
  if (!ok) {
    return jsonResponse({ error: 'invalid signature' }, 400);
  }

  /** @type {Record<string, unknown>} */
  let event = {};
  try {
    event = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }

  const data = /** @type {Record<string, unknown> | undefined} */ (event.data);
  const eventType =
    typeof data?.type === 'string' && data.type ? data.type : 'unknown';
  const topLevelEventId = typeof event.id === 'string' ? event.id : null;

  await ingestWebhookEventAndDispatch(env, ctx, {
    tenantId: null,
    workspaceId: null,
    provider: 'anthropic',
    eventType,
    eventId: topLevelEventId,
    payloadJson: rawBody,
    endpointPath: '/api/webhooks/anthropic',
    signatureValid: true,
  });

  return new Response('', { status: 200 });
}
