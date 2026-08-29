/**
 * Internal platform webhooks — shared secret (INTERNAL_WEBHOOK_SECRET).
 */
import { jsonResponse } from '../../core/auth.js';
import { getVaultSecrets, secretFromVault } from '../../core/vault.js';
import { isVaultConfigured } from '../../../backend/credentials/vault-key-material.js';
import { ingestWebhookEventAndDispatch } from '../../../backend/http/webhooks/ingest.js';

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

/** @param {any} env */
export async function resolveInternalWebhookSecret(env) {
  let secret = env?.INTERNAL_WEBHOOK_SECRET;
  if (secret != null && String(secret).trim() !== '') return String(secret).trim();
  if (env?.DB && isVaultConfigured(env)) {
    try {
      const vault = await getVaultSecrets(env);
      secret = secretFromVault(vault, env, 'INTERNAL_WEBHOOK_SECRET');
      if (secret != null && String(secret).trim() !== '') return String(secret).trim();
    } catch {
      /* vault unavailable */
    }
  }
  return null;
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function handleInternalWebhook(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const secret = await resolveInternalWebhookSecret(env);
  if (!secret) {
    return jsonResponse({ error: 'INTERNAL_WEBHOOK_SECRET not configured' }, 503);
  }

  const auth = (request.headers.get('Authorization') || '').trim();
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const header =
    (request.headers.get('X-Internal-Webhook-Secret') || '').trim() ||
    (request.headers.get('X-Webhook-Secret') || '').trim();

  if (!timingSafeEqualUtf8(bearer || header, secret)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
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
    payload?.event_type || payload?.type || payload?.event || 'internal',
  ).trim();
  const tenantId =
    typeof payload?.tenant_id === 'string' && payload.tenant_id.trim()
      ? payload.tenant_id.trim()
      : null;
  const workspaceId =
    typeof payload?.workspace_id === 'string' && payload.workspace_id.trim()
      ? payload.workspace_id.trim()
      : null;

  await ingestWebhookEventAndDispatch(env, ctx, {
    tenantId,
    workspaceId,
    provider: 'internal',
    eventType,
    eventId: payload?.id != null ? String(payload.id) : null,
    payload,
    endpointPath: '/api/webhooks/internal',
    signatureValid: true,
  });

  return jsonResponse({ ok: true });
}
