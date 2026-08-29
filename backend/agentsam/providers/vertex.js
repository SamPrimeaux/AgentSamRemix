/** Vertex adapter retained for catalog rows that explicitly select Vertex. */
import { jsonResponse } from '../../http/agentsam/shared.js';
import { openAiSseResponse } from '../runtime/provider-stream.js';

function base64Url(value) {
  return btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function vertexAccessToken(env) {
  const raw = env?.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  const account = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!account.client_email || !account.private_key) throw new Error('Service account JSON missing client_email or private_key');
  const now = Math.floor(Date.now() / 1000);
  const input = `${base64Url({ alg: 'RS256', typ: 'JWT' })}.${base64Url({ iss: account.client_email, sub: account.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const pem = account.private_key.replace(/-----BEGIN[^-]+-----|-----END[^-]+-----|\s/g, '');
  const key = await crypto.subtle.importKey(
    'pkcs8',
    Uint8Array.from(atob(pem), (char) => char.charCodeAt(0)).buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  const assertion = `${input}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`Vertex token exchange failed (${response.status})`);
  return data.access_token;
}

export async function dispatchVertexStream(env, request, params) {
  void request;
  if (!env?.GOOGLE_PROJECT_ID) return jsonResponse({ error: 'GOOGLE_PROJECT_ID is not set' }, 503);
  let token;
  try {
    token = await vertexAccessToken(env);
  } catch (error) {
    return jsonResponse({ error: 'Vertex authentication failed', detail: error?.message || String(error) }, 503);
  }
  const region = params.region || 'us-central1';
  const model = params.providerModelId || params.modelKey;
  const endpoint = `https://${region}-aiplatform.googleapis.com/v1/projects/${env.GOOGLE_PROJECT_ID}/locations/${region}/publishers/google/models/${model}:streamGenerateContent`;
  const body = {
    contents: (params.messages || []).map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof message.content === 'string' ? message.content : JSON.stringify(message.content || '') }],
    })),
    ...(params.systemPrompt ? { system_instruction: { parts: [{ text: params.systemPrompt }] } } : {}),
    generationConfig: { maxOutputTokens: Number(params.maxOutputTokens) > 0 ? Number(params.maxOutputTokens) : 8192 },
  };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(params.signal ? { signal: params.signal } : {}),
  });
  if (!response.ok) return jsonResponse({ error: `Vertex ${response.status}`, detail: (await response.text()).slice(0, 500) }, response.status);
  return openAiSseResponse(response.body);
}

export function dispatchVertexComplete() {
  throw new Error('Unsupported completion: Vertex is stream-only in the current catalog contract');
}

export { dispatchVertexStream as chatWithToolsVertex };
