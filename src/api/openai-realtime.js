/**
 * OpenAI Realtime voice — server-side ephemeral client secret endpoint.
 * tkt_oai_realtime_secret + tkt_oai_realtime_voice
 *
 * Agent Sam Voice lane only. Meet stays RealtimeKit (MEET_ENGINE var + handleRealtimeKitWebhook).
 * Never exposes the platform API key to the browser — issues an ephemeral secret instead.
 * OpenAI-Safety-Identifier: sha256('realtime:' + userId) — same hashing convention as WS transport.
 *
 * Upstream: GA POST /v1/realtime/client_secrets (browser then POSTs SDP to /v1/realtime/calls).
 */

import { isFeatureEnabled } from '../../backend/platform/feature-flags.js';
import { resolveOpenAiApiKey } from '../integrations/openai-credentials.js';
import { loadCatalogCapabilities } from '../../backend/agentsam/catalog/model-capabilities.js';
import { jsonResponse } from '../core/responses.js';
import { resolveCanonicalUserId } from '../api/auth.js';

const OPENAI_REALTIME_CLIENT_SECRETS = 'https://api.openai.com/v1/realtime/client_secrets';
const FLAG_KEY = 'openai_realtime_voice';
const DEFAULT_INSTRUCTIONS =
  'You are Agent Sam, the Inner Animal Media platform operator assistant. Keep spoken replies concise and helpful. You may call the provided tools for memory, codebase search, web search, or tool discovery when needed. This is voice chat only — Meet/video is a separate product.';

/**
 * Stable hashed safety identifier for a user — never raw user_id on the wire.
 * Pattern mirrors OpenAiResponsesWsV1 (wss transport).
 * @param {string} userId
 * @returns {Promise<string>}
 */
async function hashRealtimeSafetyId(userId) {
  const enc = new TextEncoder();
  const data = enc.encode(`realtime:${userId}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Strip any accidental secret leakage from upstream error text. */
function sanitizeRealtimeError(text) {
  return String(text || '')
    .slice(0, 1000)
    .replace(/\bsk-[a-zA-Z0-9]{10,}\b/g, '[redacted]')
    .replace(/\bek_[a-zA-Z0-9]{10,}\b/g, '[redacted]');
}

/**
 * Resolve the realtime model to use.
 * Prefers body.model if the catalog confirms supports_realtime=1.
 * Falls back to catalog default from flag config_json, then literal fallback.
 * Never hardcodes model ids in logic — catalog + flag config are SSOT.
 *
 * @param {any} env
 * @param {string|null|undefined} bodyModel
 * @param {string} flagConfigJson
 * @returns {Promise<string>}
 */
async function resolveRealtimeModel(env, bodyModel, flagConfigJson) {
  let configDefault = '';
  try {
    const cfg = JSON.parse(flagConfigJson || '{}');
    if (cfg.default_model && typeof cfg.default_model === 'string') {
      configDefault = cfg.default_model.trim();
    }
  } catch {
    /* ignore */
  }

  const candidate = bodyModel ? String(bodyModel).trim() : '';
  if (candidate) {
    const cap = await loadCatalogCapabilities(env, candidate);
    if (cap?.supports_realtime === true) return candidate;
    if (!cap) return candidate;
  }
  if (configDefault) {
    const cap = await loadCatalogCapabilities(env, configDefault);
    if (cap?.supports_realtime === true && cap?.is_active !== false) return configDefault;
  }
  // Catalog SSOT — prefer gpt-realtime-2.1, then any active openai voice/realtime row.
  if (env?.DB) {
    const row = await env.DB.prepare(
      `SELECT model_key FROM agentsam_model_catalog
       WHERE provider = 'openai'
         AND COALESCE(is_active, 1) = 1
         AND COALESCE(supports_realtime, 0) = 1
         AND COALESCE(is_degraded, 0) = 0
       ORDER BY
         CASE model_key
           WHEN 'gpt-realtime-2.1' THEN 0
           WHEN 'gpt-realtime-2.1-mini' THEN 1
           ELSE 2
         END,
         model_key ASC
       LIMIT 1`,
    )
      .first()
      .catch(() => null);
    if (row?.model_key) return String(row.model_key);
  }
  throw new Error('no_active_openai_realtime_model_in_catalog');
}

/**
 * Normalize GA client_secrets + legacy sessions shapes for the browser.
 * Browser needs a non-empty `value` (ek_…) for Authorization on /v1/realtime/calls.
 * @param {Record<string, any>} sessionData
 */
function normalizeClientSecretPayload(sessionData) {
  const raw = sessionData && typeof sessionData === 'object' ? sessionData : {};
  const value =
    (typeof raw.value === 'string' && raw.value.trim()) ||
    (typeof raw.client_secret?.value === 'string' && raw.client_secret.value.trim()) ||
    '';
  const expiresAt =
    raw.expires_at ??
    raw.client_secret?.expires_at ??
    raw.session?.expires_at ??
    null;
  return {
    ...raw,
    value: value || undefined,
    client_secret: raw.client_secret?.value
      ? raw.client_secret
      : value
        ? { value, expires_at: expiresAt }
        : raw.client_secret,
  };
}

/**
 * POST /api/openai/realtime/client-secret
 *
 * Body (JSON, all optional):
 *   { "model": "gpt-realtime-2.1", "voice": "alloy", "instructions": "..." }
 *
 * Returns (normalized):
 *   { value: "ek_…", client_secret: { value, expires_at }, … }
 *
 * @param {Request} request
 * @param {any} env
 * @param {any} ctx
 * @param {{ userId?: string|null, tenantId?: string|null }} authCtx
 */
export async function handleOpenAiRealtimeClientSecret(request, env, ctx, authCtx = {}) {
  const rawUserId = authCtx.userId ? String(authCtx.userId).trim() : null;
  const userId = rawUserId ? await resolveCanonicalUserId(rawUserId, env) : null;
  const tenantId = authCtx.tenantId ? String(authCtx.tenantId).trim() : null;

  if (!userId) {
    return jsonResponse(
      {
        error: 'Unauthorized',
        code: rawUserId ? 'auth_user_id_required' : 'auth_required',
      },
      401,
    );
  }

  // ── 1. Feature flag — fail-closed ──────────────────────────────────────────
  let flagEnabled = false;
  let flagConfigJson = '{}';
  try {
    const row = await env.DB.prepare(
      `SELECT enabled_globally, enabled_for_users, config_json
         FROM agentsam_feature_flag WHERE flag_key = ? AND is_archived = 0 LIMIT 1`,
    )
      .bind(FLAG_KEY)
      .first();
    if (row) {
      flagConfigJson = String(row.config_json || '{}');
      flagEnabled = await isFeatureEnabled(env, FLAG_KEY, { userId, tenantId });
    }
  } catch (e) {
    console.warn('[openai_realtime] flag_check_error', e?.message ?? e);
  }

  if (!flagEnabled) {
    console.info('[openai_realtime] flag_denied', { userId_prefix: userId.slice(0, 8) });
    return jsonResponse(
      { error: 'openai_realtime_voice not enabled for this account', code: 'flag_off' },
      403,
    );
  }

  // ── 2. Parse body + flag defaults ──────────────────────────────────────────
  let body = {};
  try {
    body = await request.json();
  } catch {
    /* optional body */
  }

  let configVoice = 'alloy';
  try {
    const cfg = JSON.parse(flagConfigJson || '{}');
    if (typeof cfg.default_voice === 'string' && cfg.default_voice.trim()) {
      configVoice = cfg.default_voice.trim();
    }
  } catch {
    /* keep alloy */
  }

  const voice =
    typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim() : configVoice;
  const instructions =
    typeof body.instructions === 'string' && body.instructions.trim()
      ? body.instructions.trim()
      : DEFAULT_INSTRUCTIONS;

  // ── 3. Resolve model (catalog SSOT) ────────────────────────────────────────
  const model = await resolveRealtimeModel(env, body.model, flagConfigJson);

  // ── 4. Resolve API key (BYOK first, platform fallback) ─────────────────────
  const apiKey = await resolveOpenAiApiKey(env, model, userId, {});
  if (!apiKey) {
    console.warn('[openai_realtime] api_key_missing', { userId_prefix: userId.slice(0, 8) });
    return jsonResponse({ error: 'OpenAI API key not configured', code: 'no_api_key' }, 503);
  }

  // ── 5. Safety identifier — hashed, never raw user_id on the wire ───────────
  const safetyId = await hashRealtimeSafetyId(userId);

  // ── 6. Issue ephemeral client secret (GA) ──────────────────────────────────
  const sessionBody = {
    session: {
      type: 'realtime',
      model,
      instructions,
      audio: {
        input: {
          transcription: { model: 'gpt-4o-mini-transcribe' },
        },
        output: { voice },
      },
    },
  };

  let upstreamRes;
  try {
    upstreamRes = await fetch(OPENAI_REALTIME_CLIENT_SECRETS, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': safetyId,
      },
      body: JSON.stringify(sessionBody),
    });
  } catch (e) {
    console.error('[openai_realtime] upstream_fetch_failed', e?.message ?? e);
    return jsonResponse({ error: 'OpenAI Realtime request failed', detail: e?.message }, 502);
  }

  if (!upstreamRes.ok) {
    const errText = await upstreamRes.text().catch(() => '');
    const safe = sanitizeRealtimeError(errText);
    console.warn(
      `[openai_realtime] upstream_error status=${upstreamRes.status} body=${safe}`,
    );
    return jsonResponse(
      { error: 'OpenAI Realtime API error', status: upstreamRes.status, detail: safe },
      upstreamRes.status,
    );
  }

  const sessionData = normalizeClientSecretPayload(await upstreamRes.json().catch(() => ({})));
  if (!sessionData.value) {
    console.warn('[openai_realtime] client_secret_missing_value');
    return jsonResponse({ error: 'OpenAI Realtime secret missing value', code: 'no_secret' }, 502);
  }

  // ── 7. Log — never log client_secret value ────────────────────────────────
  console.info('[openai_realtime] client_secret_issued', {
    userId_hash: safetyId.slice(0, 12),
    model,
    voice,
    session_id: sessionData?.id ?? sessionData?.session?.id ?? null,
    expires_at: sessionData?.client_secret?.expires_at ?? sessionData?.expires_at ?? null,
  });

  return new Response(JSON.stringify(sessionData), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
