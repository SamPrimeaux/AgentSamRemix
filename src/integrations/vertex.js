// src/integrations/vertex.js
/**
 * Google Vertex AI Integration
 * Gemini models via GCP Vertex AI — Service Account JWT auth, SSE streaming.
 *
 * Env bindings used (must match wrangler.toml exactly):
 *   GOOGLE_SERVICE_ACCOUNT_JSON  — service account key JSON (secret)
 *   GOOGLE_PROJECT_ID            — GCP project ID (secret)
 */
import { jsonResponse } from '../core/responses.js';
import { getAuthUser } from '../core/auth.js';

const TOKEN_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TOKEN_URL   = 'https://oauth2.googleapis.com/token';

// ─── Service Account JWT → Access Token ──────────────────────────────────────

function b64url(obj) {
  return btoa(JSON.stringify(obj))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function importSAPrivateKey(pem) {
  const stripped = pem
    .replace(/-----BEGIN[^-]+-----/, '')
    .replace(/-----END[^-]+-----/, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(stripped), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

export async function getVertexAccessToken(env) {
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  }

  let sa;
  try {
    sa = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
  }

  if (!sa.client_email || !sa.private_key) {
    throw new Error('Service account JSON missing client_email or private_key');
  }

  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    scope: TOKEN_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const key = await importSAPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const jwt = `${signingInput}.${sigB64}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`SA token exchange failed (${res.status}): ${err}`);
  }

  const { access_token } = await res.json();
  if (!access_token) throw new Error('SA token exchange returned no access_token');
  return access_token;
}

// ─── Vertex AI Streaming Chat ─────────────────────────────────────────────────

/**
 * @param {object} env
 * @param {Request} request
 * @param {object} params
 * @param {string}   params.modelKey      - Gemini model ID (default: gemini-1.5-pro)
 * @param {Array}    params.messages      - [{role, content}]
 * @param {string}   params.systemPrompt
 * @param {string}   [params.region]      - GCP region (default: us-central1)
 * @param {number}   [params.temperature]
 * @param {number}   [params.maxTokens]
 */
export async function chatWithToolsVertex(env, request, params) {
  const {
    modelKey = 'gemini-1.5-pro',
    providerModelId,
    messages,
    systemPrompt,
    region = 'us-central1',
    temperature = 0.7,
    maxTokens = 8192,
  } = params;
  const vertexModel =
    providerModelId != null && String(providerModelId).trim() !== ''
      ? String(providerModelId).trim()
      : modelKey;

  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

  const projectId = env.GOOGLE_PROJECT_ID;
  if (!projectId) return jsonResponse({ error: 'GOOGLE_PROJECT_ID is not set' }, 503);

  let accessToken;
  try {
    accessToken = await getVertexAccessToken(env);
  } catch (e) {
    console.error('[Vertex] Auth error:', e.message);
    return jsonResponse({ error: 'Vertex authentication failed', detail: e.message }, 503);
  }

  const endpoint =
    `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}` +
    `/locations/${region}/publishers/google/models/${vertexModel}:streamGenerateContent`;

  const body = {
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    ...(systemPrompt && {
      system_instruction: { parts: [{ text: systemPrompt }] },
    }),
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
    },
  };

  const { readable, writable } = new TransformStream();
  const writer  = writable.getWriter();
  const encoder = new TextEncoder();

  (async () => {
    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!upstream.ok) {
        const err = await upstream.text();
        await writer.write(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', message: err })}\n\n`)
        );
        return;
      }

      const reader  = upstream.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(encoder.encode(decoder.decode(value)));
      }
    } catch (e) {
      await writer.write(
        encoder.encode(`data: ${JSON.stringify({ type: 'error', message: e.message })}\n\n`)
      );
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
