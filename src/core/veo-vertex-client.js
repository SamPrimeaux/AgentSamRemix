/**
 * Veo long-running generate + poll + download.
 *
 * Primary surface (matches live GOOGLE_AI_API_KEY model list):
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{id}:predictLongRunning
 *   Auth: x-goog-api-key (never Bearer with an API key)
 *
 * Optional fallback: Vertex AI publisher models + GOOGLE_SERVICE_ACCOUNT_JSON
 * when explicitly requested or when no Gemini API key is present.
 */
import { getVertexAccessToken } from '../integrations/vertex.js';

const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_LOCATION = 'us-central1';

export function resolveVeoProjectId(env) {
  return String(
    env?.GOOGLE_PROJECT_ID || env?.GOOGLE_CLOUD_PROJECT || env?.GCP_PROJECT_ID || '',
  ).trim();
}

export function resolveVeoLocation(env) {
  return String(env?.GOOGLE_VERTEX_LOCATION || env?.GCP_LOCATION || DEFAULT_LOCATION).trim() || DEFAULT_LOCATION;
}

/** Gemini model resource name always includes `models/`. */
export function normalizeGeminiVeoModelId(raw) {
  let id = String(raw || '').trim();
  if (!id) return '';
  if (id.startsWith('publishers/google/models/')) {
    id = id.slice('publishers/google/models/'.length);
  }
  if (!id.startsWith('models/')) id = `models/${id}`;
  return id;
}

/** Vertex publisher model ids omit the Gemini-style `models/` prefix. */
export function normalizeVertexVeoModelId(raw) {
  let id = String(raw || '').trim();
  if (!id) return '';
  if (id.startsWith('models/')) id = id.slice('models/'.length);
  if (id.startsWith('publishers/google/models/')) {
    id = id.slice('publishers/google/models/'.length);
  }
  return id;
}

export function isVertexVeoPlatform(rowOrPlatform) {
  const plat = String(
    typeof rowOrPlatform === 'string'
      ? rowOrPlatform
      : rowOrPlatform?.resolved_platform ||
          rowOrPlatform?.api_platform ||
          rowOrPlatform?.platform ||
          '',
  )
    .trim()
    .toLowerCase();
  return plat.includes('vertex') || plat === 'google_vertex';
}

export function resolveGeminiApiKey(env) {
  const key = env?.GOOGLE_AI_API_KEY || env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY;
  return key ? String(key).trim() : '';
}

/**
 * Choose API surface.
 * Default: Gemini Developer API when an API key exists (proven by models.list).
 * Vertex only when forceVertex or no API key but SA is configured.
 */
export function resolveVeoSurface(env, { forceVertex = false } = {}) {
  const apiKey = resolveGeminiApiKey(env);
  if (!forceVertex && apiKey) {
    return { surface: 'gemini', apiKey };
  }
  if (env?.GOOGLE_SERVICE_ACCOUNT_JSON && resolveVeoProjectId(env)) {
    return { surface: 'vertex', apiKey: null };
  }
  if (apiKey) return { surface: 'gemini', apiKey };
  return { surface: null, apiKey: null };
}

/**
 * Gemini Veo predictLongRunning requires durationSeconds in [4, 8].
 * Clamp before send so UI/tool defaults (e.g. 10) don't 400 INVALID_ARGUMENT.
 */
export function clampVeoDurationSeconds(raw, fallback = 5) {
  const n = Number(raw);
  const base = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.max(4, Math.min(8, Math.round(base)));
}

/**
 * Build predictLongRunning body.
 * Gemini Developer API Veo rejects `negativePrompt` — fold into prompt text instead.
 * Vertex may still accept a separate negative field.
 */
export function buildVeoBody({
  prompt,
  negativePrompt,
  durationSeconds = 5,
  aspectRatio = '16:9',
  resolution = '720p',
  sampleCount = 1,
  surface = 'gemini',
} = {}) {
  let promptText = String(prompt || '').trim();
  const neg = String(negativePrompt || '').trim();
  const allowSeparateNegative = surface === 'vertex' && !!neg;

  if (neg && !allowSeparateNegative) {
    // Gemini: field unsupported — keep intent in the main prompt.
    promptText = `${promptText}\n\nAvoid: ${neg}`.trim();
  }

  const instance = { prompt: promptText };
  if (allowSeparateNegative) {
    instance.negativePrompt = neg;
  }
  return {
    instances: [instance],
    parameters: {
      sampleCount: Math.max(1, Math.min(4, Number(sampleCount) || 1)),
      durationSeconds: clampVeoDurationSeconds(durationSeconds, 5),
      aspectRatio: aspectRatio || '16:9',
      resolution: resolution || '720p',
    },
  };
}

async function startGeminiVeoLongRunning(env, opts) {
  const apiKey = resolveGeminiApiKey(env);
  if (!apiKey) return { ok: false, error: 'GOOGLE_AI_API_KEY (or GEMINI/GOOGLE_API_KEY) not configured' };

  const modelId = normalizeGeminiVeoModelId(opts.modelId);
  if (!modelId) return { ok: false, error: 'Veo model id required' };

  const endpoint = `${GEMINI_API_ROOT}/${modelId}:predictLongRunning`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(buildVeoBody({ ...opts, surface: 'gemini' })),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return {
      ok: false,
      status: res.status,
      error: `Veo Gemini API ${res.status}: ${errText.slice(0, 400)}`,
      modelId,
      surface: 'gemini',
    };
  }

  const data = await res.json().catch(() => ({}));
  const operationName = data?.name ? String(data.name) : null;
  if (!operationName) {
    return { ok: false, error: 'Veo returned no operation name', modelId, surface: 'gemini' };
  }

  return {
    ok: true,
    operationName,
    modelId,
    surface: 'gemini',
    auth: 'api_key',
  };
}

async function startVertexOnlyVeoLongRunning(env, opts) {
  const projectId = resolveVeoProjectId(env);
  if (!projectId) return { ok: false, error: 'GOOGLE_PROJECT_ID not configured' };
  if (!env?.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return { ok: false, error: 'GOOGLE_SERVICE_ACCOUNT_JSON required for Vertex Veo' };
  }

  const location = resolveVeoLocation(env);
  const vertexModelId = normalizeVertexVeoModelId(opts.modelId);
  if (!vertexModelId) return { ok: false, error: 'Veo model id required' };

  let accessToken;
  try {
    accessToken = await getVertexAccessToken(env);
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }

  const endpoint =
    `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(vertexModelId)}:predictLongRunning`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildVeoBody({ ...opts, surface: 'vertex' })),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return {
      ok: false,
      status: res.status,
      error: `Veo Vertex API ${res.status}: ${errText.slice(0, 400)}`,
      modelId: vertexModelId,
      projectId,
      surface: 'vertex',
    };
  }

  const data = await res.json().catch(() => ({}));
  const operationName = data?.name ? String(data.name) : null;
  if (!operationName) {
    return { ok: false, error: 'Veo returned no operation name', modelId: vertexModelId, surface: 'vertex' };
  }

  return {
    ok: true,
    operationName,
    modelId: vertexModelId,
    projectId,
    location,
    surface: 'vertex',
    auth: 'service_account',
  };
}

/**
 * Start Veo LRO. Prefer Gemini Developer API (API key).
 * @returns {{ ok: true, operationName: string, modelId: string, surface: string } | { ok: false, error: string, status?: number }}
 */
export async function startVeoLongRunning(env, opts = {}) {
  const forceVertex = opts.forceVertex === true;
  const chosen = resolveVeoSurface(env, { forceVertex });
  if (!chosen.surface) {
    return {
      ok: false,
      error:
        'Veo auth missing: set GOOGLE_AI_API_KEY (Gemini Developer API) or GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_PROJECT_ID (Vertex)',
    };
  }
  if (chosen.surface === 'gemini') {
    return startGeminiVeoLongRunning(env, opts);
  }
  return startVertexOnlyVeoLongRunning(env, opts);
}

/** @deprecated use startVeoLongRunning — kept for existing imports */
export async function startVertexVeoLongRunning(env, opts = {}) {
  return startVeoLongRunning(env, opts);
}

async function pollGeminiVeoOperation(env, operationName) {
  const apiKey = resolveGeminiApiKey(env);
  if (!apiKey) return { ok: false, error: 'GOOGLE_AI_API_KEY required to poll Gemini Veo ops' };
  const name = String(operationName || '').replace(/^\//, '').trim();
  if (!name) return { ok: false, error: 'operation_name required' };

  // Ops are usually `models/.../operations/...` under v1beta.
  const url = `${GEMINI_API_ROOT}/${name}`;
  const res = await fetch(url, {
    headers: { 'x-goog-api-key': apiKey },
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    return { ok: false, error: `Veo Gemini poll ${res.status}: ${err.slice(0, 300)}`, status: res.status };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, data, surface: 'gemini', auth: 'api_key' };
}

async function pollVertexOnlyVeoOperation(env, operationName) {
  const name = String(operationName || '').replace(/^\//, '').trim();
  if (!name) return { ok: false, error: 'operation_name required' };
  if (!env?.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return { ok: false, error: 'GOOGLE_SERVICE_ACCOUNT_JSON required for Vertex poll' };
  }

  let accessToken;
  try {
    accessToken = await getVertexAccessToken(env);
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }

  let location = resolveVeoLocation(env);
  const locMatch = name.match(/\/locations\/([^/]+)\//);
  if (locMatch?.[1]) location = locMatch[1];

  const url = `https://${location}-aiplatform.googleapis.com/v1/${name}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    return { ok: false, error: `Veo Vertex poll ${res.status}: ${err.slice(0, 300)}`, status: res.status };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, data, surface: 'vertex', auth: 'service_account' };
}

/**
 * Poll a Veo LRO. Detects surface from operation name shape.
 */
export async function pollVeoOperation(env, operationName) {
  const name = String(operationName || '').replace(/^\//, '').trim();
  if (!name) return { ok: false, error: 'operation_name required' };

  const looksVertex = name.startsWith('projects/') || name.includes('/locations/');
  if (looksVertex) return pollVertexOnlyVeoOperation(env, name);
  return pollGeminiVeoOperation(env, name);
}

/** @deprecated use pollVeoOperation */
export async function pollVertexVeoOperation(env, operationName) {
  return pollVeoOperation(env, operationName);
}

async function downloadGsUri(env, gsUri) {
  const m = String(gsUri || '').match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  if (!env?.GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  let accessToken;
  try {
    accessToken = await getVertexAccessToken(env);
  } catch {
    return null;
  }
  const bucket = m[1];
  const object = m[2];
  const url =
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}` +
    `/o/${encodeURIComponent(object)}?alt=media`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

async function downloadHttpUri(env, uriStr) {
  const headers = {};
  // Gemini file download URLs need the API key.
  if (uriStr.includes('generativelanguage.googleapis.com')) {
    const apiKey = resolveGeminiApiKey(env);
    if (apiKey) headers['x-goog-api-key'] = apiKey;
  }
  const res = await fetch(uriStr, { headers });
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

function collectVideoCandidates(data) {
  const out = [];
  const push = (v) => {
    if (v && typeof v === 'object') out.push(v);
  };

  const resp = data?.response || data || {};
  const videos = resp.videos || resp.predictions?.[0]?.videos || resp.predictions || [];
  if (Array.isArray(videos)) videos.forEach(push);

  const samples =
    resp.generateVideoResponse?.generatedSamples ||
    resp.generatedSamples ||
    [];
  if (Array.isArray(samples)) {
    for (const s of samples) {
      push(s?.video || s);
    }
  }
  return out;
}

/**
 * Extract MP4 bytes from a completed Veo operation payload.
 */
export async function downloadVeoVideoBytes(env, data) {
  const candidates = collectVideoCandidates(data);
  const first = candidates[0] || null;

  const b64 =
    first?.bytesBase64Encoded ||
    first?.video?.bytesBase64Encoded ||
    data?.response?.bytesBase64Encoded ||
    null;
  if (b64) {
    const bin = atob(String(b64));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const uri =
    first?.gcsUri ||
    first?.uri ||
    first?.video?.uri ||
    first?.video?.gcsUri ||
    data?.response?.gcsUri ||
    null;
  if (!uri) return null;

  const uriStr = String(uri);
  if (uriStr.startsWith('http://') || uriStr.startsWith('https://')) {
    return downloadHttpUri(env, uriStr);
  }
  if (uriStr.startsWith('gs://')) {
    return downloadGsUri(env, uriStr);
  }
  return null;
}
