/**
 * OpenAI inbound webhooks — Standard Webhooks verify (whsec_) + legacy fallback,
 * D1 audit, registry dispatch, Batch embed usage ingest.
 */
import { jsonResponse } from '../../core/auth.js';
import { getVaultSecrets, secretFromVault } from '../../core/vault.js';
import { isVaultConfigured } from '../../../backend/credentials/vault-key-material.js';
import { ingestWebhookEventAndDispatch } from '../../../backend/http/webhooks/ingest.js';

const STANDARD_TOLERANCE_SEC = 300;

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

/** @param {string} b64 */
function base64ToBytes(b64) {
  const bin = atob(String(b64 || '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** @param {string} secret */
function decodeWebhookSecret(secret) {
  const s = String(secret || '').trim();
  if (s.startsWith('whsec_')) {
    return base64ToBytes(s.slice('whsec_'.length));
  }
  return new TextEncoder().encode(s);
}

/** @param {string} secret @param {string} message */
async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/**
 * Standard Webhooks (OpenAI dashboard whsec_ secrets).
 * Signed payload: `{webhook-id}.{webhook-timestamp}.{rawBody}`
 * Header: webhook-signature = `v1,<base64>` (space-separated if multiple).
 *
 * @param {string} rawBody
 * @param {Headers} headers
 * @param {string} secret
 * @param {number} [toleranceSec]
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function verifyOpenAiStandardWebhook(rawBody, headers, secret, toleranceSec = STANDARD_TOLERANCE_SEC) {
  const signatureHeader = (headers.get('webhook-signature') || '').trim();
  const timestamp = (headers.get('webhook-timestamp') || '').trim();
  const webhookId = (headers.get('webhook-id') || '').trim();
  if (!signatureHeader || !timestamp || !webhookId) {
    return { ok: false, reason: 'missing_standard_headers' };
  }

  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'invalid_timestamp' };
  const now = Math.floor(Date.now() / 1000);
  if (now - ts > toleranceSec) return { ok: false, reason: 'timestamp_too_old' };
  if (ts > now + toleranceSec) return { ok: false, reason: 'timestamp_too_new' };

  const signatures = signatureHeader.split(/\s+/).map((part) =>
    part.startsWith('v1,') ? part.slice(3) : part,
  );
  const signedPayload = `${webhookId}.${timestamp}.${rawBody}`;
  const keyBytes = decodeWebhookSecret(secret);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const payloadBytes = new TextEncoder().encode(signedPayload);

  for (const sig of signatures) {
    if (!sig) continue;
    try {
      const sigBytes = base64ToBytes(sig);
      const valid = await crypto.subtle.verify('HMAC', key, sigBytes, payloadBytes);
      if (valid) return { ok: true };
    } catch {
      /* try next */
    }
  }
  return { ok: false, reason: 'signature_mismatch' };
}

/**
 * Legacy IAM verifier: HMAC-SHA256 hex of raw body, header x-openai-signature.
 * @param {string} rawBody
 * @param {Headers} headers
 * @param {string} secret
 */
async function verifyLegacyOpenAiWebhook(rawBody, headers, secret) {
  const sig = (headers.get('x-openai-signature') || '').trim();
  if (!sig) return { ok: false, reason: 'missing_legacy_header' };
  const expected = await hmacSha256Hex(secret, rawBody);
  if (!timingSafeEqualUtf8(sig.toLowerCase(), expected.toLowerCase())) {
    return { ok: false, reason: 'legacy_signature_mismatch' };
  }
  return { ok: true };
}

/**
 * Prefer Standard Webhooks when those headers are present; else legacy.
 * @param {string} rawBody
 * @param {Headers} headers
 * @param {string} secret
 */
export async function verifyOpenAiWebhookRequest(rawBody, headers, secret) {
  const hasStandard =
    headers.get('webhook-signature') &&
    headers.get('webhook-timestamp') &&
    headers.get('webhook-id');
  if (hasStandard) {
    return verifyOpenAiStandardWebhook(rawBody, headers, secret);
  }
  return verifyLegacyOpenAiWebhook(rawBody, headers, secret);
}

/** @param {any} env */
async function resolveOpenAiWebhookSecret(env) {
  let secret = env?.OPENAI_WEBHOOK_SECRET;
  if (secret != null && String(secret).trim() !== '') return String(secret).trim();
  if (env?.DB && isVaultConfigured(env)) {
    try {
      const vault = await getVaultSecrets(env);
      secret = secretFromVault(vault, env, 'OPENAI_WEBHOOK_SECRET');
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
export async function handleOpenAiWebhook(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const raw = await request.text();
  const key = await resolveOpenAiWebhookSecret(env);
  if (key) {
    const verified = await verifyOpenAiWebhookRequest(raw, request.headers, key);
    if (!verified.ok) {
      console.warn('[openai-webhook] signature_rejected', verified.reason);
      return jsonResponse({ error: 'invalid signature', reason: verified.reason }, 401);
    }
  }

  /** @type {Record<string, unknown>} */
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }

  const eventType = String(payload?.type || 'unknown').trim();
  const ingested = await ingestWebhookEventAndDispatch(env, ctx, {
    tenantId: null,
    workspaceId: null,
    provider: 'openai',
    eventType,
    eventId: payload?.id != null ? String(payload.id) : null,
    payload,
    endpointPath: '/api/webhooks/openai',
    signatureValid: Boolean(key),
  });

  // Batch embeds + background Responses → agentsam_usage_events (sync paths stamp elsewhere).
  const et = eventType.toLowerCase();
  if (et.startsWith('batch.') || et.startsWith('response.')) {
    const run = async () => {
      try {
        if (et.startsWith('batch.')) {
          const { ingestOpenAiBatchEmbedUsageFromWebhook } = await import(
            '../../../backend/telemetry/openai-batch-embed-usage.js'
          );
          const out = await ingestOpenAiBatchEmbedUsageFromWebhook(env, ctx, payload, {
            webhookEventId: ingested?.id ?? null,
          });
          if (!out?.skipped) {
            console.info('[openai-webhook] batch_embed_usage', JSON.stringify(out));
          }
        } else {
          const { ingestOpenAiResponseUsageFromWebhook } = await import(
            '../../../backend/telemetry/openai-response-usage.js'
          );
          const out = await ingestOpenAiResponseUsageFromWebhook(env, ctx, payload, {
            webhookEventId: ingested?.id ?? null,
          });
          if (!out?.skipped) {
            console.info('[openai-webhook] response_usage', JSON.stringify(out));
          }
        }
      } catch (e) {
        console.warn(
          '[openai-webhook] usage_ingest_failed',
          et.startsWith('batch.') ? 'batch' : 'response',
          e?.message ?? e,
        );
      }
    };
    if (ctx?.waitUntil) ctx.waitUntil(run());
    else await run();
  }

  return jsonResponse({ ok: true, webhook_event_id: ingested?.id ?? null });
}
