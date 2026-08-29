/**
 * Cursor Cloud Agents webhook — docs: https://cursor.com/docs/cloud-agent/api/webhooks
 *
 * Headers: X-Webhook-Signature, X-Webhook-ID, X-Webhook-Event
 * Payload: event, timestamp, id (bc_… agent id), status, source, target, summary
 */
import { jsonResponse } from '../../core/auth.js';
import { getVaultSecrets, secretFromVault } from '../../core/vault.js';
import { ingestWebhookEventAndDispatch } from '../../../backend/http/webhooks/ingest.js';
import { normalizeGithubRepoFullName } from '../../../backend/services/webhooks/ledger.js';

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
 * Cursor never sends tenant/workspace — resolve from the run that spawned bc_….
 * @param {any} env
 * @param {string} cursorAgentId
 */
async function lookupScopeByCursorAgentId(env, cursorAgentId) {
  const id = cursorAgentId != null ? String(cursorAgentId).trim() : '';
  if (!id || !env?.DB) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT id, tenant_id, workspace_id, user_id, status
       FROM agentsam_agent_run
       WHERE external_agent_id = ?
       ORDER BY created_at_unix DESC
       LIMIT 1`,
    )
      .bind(id)
      .first();
    if (!row) return null;
    const tenantId =
      row.tenant_id != null && String(row.tenant_id).trim() !== ''
        ? String(row.tenant_id).trim()
        : null;
    const workspaceId =
      row.workspace_id != null && String(row.workspace_id).trim() !== ''
        ? String(row.workspace_id).trim()
        : null;
    return {
      agentRunId: row.id != null ? String(row.id) : null,
      tenantId,
      workspaceId,
      userId: row.user_id != null ? String(row.user_id) : null,
      runStatus: row.status != null ? String(row.status) : null,
    };
  } catch (e) {
    console.warn('[cursor-webhook] agent_run lookup', e?.message ?? e);
    return null;
  }
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function handleCursorWebhook(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let secret = env.CURSOR_WEBHOOK_SECRET;
  if (!secret && env.DB && env.VAULT_KEY) {
    try {
      const vault = await getVaultSecrets(env);
      secret = secretFromVault(vault, env, 'CURSOR_WEBHOOK_SECRET');
    } catch {
      /* vault unavailable */
    }
  }
  if (!secret) {
    return jsonResponse({ error: 'CURSOR_WEBHOOK_SECRET not configured' }, 503);
  }

  const rawBody = await request.text();
  // Docs: X-Webhook-Signature only (sha256=<hex>).
  const sigHeader = (request.headers.get('X-Webhook-Signature') || '').trim();
  const m = /^sha256=([0-9a-fA-F]+)$/.exec(sigHeader);
  if (!m) {
    return jsonResponse({ error: 'invalid signature' }, 401);
  }

  const recvHex = m[1].toLowerCase();
  const expectedHex = (await hmacSha256Hex(secret, rawBody)).toLowerCase();
  if (recvHex.length !== expectedHex.length || !timingSafeEqualUtf8(recvHex, expectedHex)) {
    return jsonResponse({ error: 'invalid signature' }, 401);
  }

  let payload = {};
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }

  // Docs: X-Webhook-Event header; body.event is "statusChange". Prefer header, then body.event.
  const eventType = String(
    request.headers.get('X-Webhook-Event') || payload?.event || 'unknown',
  ).trim();

  // Local /api/cursor/probe HMAC round-trip — verify signature only, no workflow.
  if (eventType === 'iam_probe') {
    return jsonResponse({ ok: true, probe: true });
  }

  // Docs: payload.id is the Cursor agent id (bc_…), not a delivery id.
  const cursorAgentId = payload?.id != null ? String(payload.id).trim() : '';
  // Docs: X-Webhook-ID is the unique delivery id (dedup / logging).
  const deliveryId = (request.headers.get('X-Webhook-ID') || '').trim() || null;

  const scope = cursorAgentId ? await lookupScopeByCursorAgentId(env, cursorAgentId) : null;

  const sourceRepoRaw =
    payload?.source && typeof payload.source === 'object'
      ? /** @type {any} */ (payload.source).repository
      : null;
  const repoFullName = normalizeGithubRepoFullName(sourceRepoRaw);

  // Cursor docs: return 2xx ASAP (agent FINISHED/ERROR is time-sensitive; tighter client
  // timeout than GitHub/OpenAI). Do NOT copy deferDispatch to other providers for parity.
  // Trade-off: Cursor will not retry after this 2xx — deferred dispatch failures must land
  // on agentsam_webhook_events.status='failed' (see ingestWebhookEventAndDispatch).
  const ingest = await ingestWebhookEventAndDispatch(
    env,
    ctx,
    {
      provider: 'cursor',
      eventType,
      eventId: deliveryId || (cursorAgentId ? `cursor:${cursorAgentId}:${eventType}:${payload?.status || ''}` : null),
      payload,
      endpointPath: '/api/webhooks/cursor',
      signatureValid: true,
      metadata: {
        cursor_agent_id: cursorAgentId || null,
        status: payload?.status ?? null,
        repo_full_name: repoFullName,
        webhook_delivery_id: deliveryId,
      },
      tenantId: scope?.tenantId ?? null,
      workspaceId: scope?.workspaceId ?? null,
    },
    { deferDispatch: true },
  );

  if (!ingest?.ok) {
    return jsonResponse(
      { error: 'ingest_failed', reason: ingest?.reason ?? 'unknown' },
      ingest?.reason === 'missing_tenant_id' ? 503 : 500,
    );
  }

  return jsonResponse({ ok: true, event_id: ingest.id, delivery_id: deliveryId });
}
