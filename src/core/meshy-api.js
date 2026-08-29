/**
 * Meshy REST client for Cloudflare Worker (Bearer MESHYAI_API_KEY).
 * Port of meshy_client.py contract — no Python in production.
 */
import { estimateMeshyOperationCost } from './meshy-credits.js';

export const MESHY_API_ORIGIN = 'https://api.meshy.ai';

/** @type {Record<string, { base: string; version: string }>} */
export const MESHY_TASK_ROUTES = {
  'text-to-3d': { base: '/openapi/v2/text-to-3d', version: 'v2' },
  'image-to-3d': { base: '/openapi/v1/image-to-3d', version: 'v1' },
  'multi-image-to-3d': { base: '/openapi/v1/multi-image-to-3d', version: 'v1' },
  retexture: { base: '/openapi/v1/retexture', version: 'v1' },
  remesh: { base: '/openapi/v1/remesh', version: 'v1' },
  convert: { base: '/openapi/v1/convert', version: 'v1' },
  resize: { base: '/openapi/v1/resize', version: 'v1' },
  rigging: { base: '/openapi/v1/rigging', version: 'v1' },
  animation: { base: '/openapi/v1/animations', version: 'v1' },
  'text-to-image': { base: '/openapi/v1/text-to-image', version: 'v1' },
  'image-to-image': { base: '/openapi/v1/image-to-image', version: 'v1' },
  'uv-unwrap': { base: '/openapi/v1/uv-unwrap', version: 'v1' },
  'print-multi-color': { base: '/openapi/v1/print/multi-color', version: 'v1' },
  'print-repair': { base: '/openapi/v1/print/repair', version: 'v1' },
  'print-analyze': { base: '/openapi/v1/print/analyze', version: 'v1' },
};

export class MeshyApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {unknown} [body]
   */
  constructor(message, status, body = null) {
    super(message);
    this.name = 'MeshyApiError';
    this.status = status;
    this.body = body;
  }
}

export class MeshyInsufficientCreditsError extends MeshyApiError {
  /**
   * @param {number} balance
   * @param {number} required
   */
  constructor(balance, required) {
    super(`Insufficient Meshy credits: have ${balance}, need ${required}`, 402, {
      balance,
      required,
      billing_url: 'https://www.meshy.ai/pricing',
    });
    this.name = 'MeshyInsufficientCreditsError';
    this.balance = balance;
    this.required = required;
  }
}

export class MeshyRateLimitError extends MeshyApiError {
  /** @param {number} [retryAfterMs] */
  constructor(retryAfterMs = 5000) {
    super('Meshy API rate limited (429)', 429, { retry_after_ms: retryAfterMs });
    this.name = 'MeshyRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * @param {any} env
 */
export function meshyApiKey(env) {
  return String(env?.MESHYAI_API_KEY || '').trim();
}

/**
 * @param {any} env
 */
export function isMeshyStubKey(env) {
  const key = meshyApiKey(env);
  return !key || key.startsWith('sk-meshy-stub') || key === 'stub';
}

/**
 * @param {string} taskType
 */
export function resolveMeshyTaskRoute(taskType) {
  const key = String(taskType || 'text-to-3d').trim().toLowerCase();
  return MESHY_TASK_ROUTES[key] || MESHY_TASK_ROUTES['text-to-3d'];
}

/**
 * Low-level Meshy fetch with Bearer auth, 429 retry (once), structured errors.
 * @param {any} env
 * @param {string} path — path starting with /openapi/…
 * @param {RequestInit} [init]
 * @param {{ retries?: number; apiKey?: string | null }} [opts]
 */
export async function meshyFetch(env, path, init = {}, opts = {}) {
  const key = opts.apiKey ?? meshyApiKey(env);
  if (!key) throw new MeshyApiError('MESHYAI_API_KEY not configured', 503);

  const url = `${MESHY_API_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
    ...(init.headers || {}),
  };
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const maxRetries = opts.retries ?? 1;
  let attempt = 0;
  /** @type {Response | null} */
  let res = null;

  while (attempt <= maxRetries) {
    res = await fetch(url, { ...init, headers });
    if (res.status !== 429 || attempt >= maxRetries) break;
    const retryAfter = Number(res.headers.get('Retry-After') || '5') * 1000;
    await new Promise((r) => setTimeout(r, Math.min(retryAfter, 15000)));
    attempt += 1;
  }

  if (!res) throw new MeshyApiError('Meshy fetch failed', 502);

  if (res.status === 429) {
    throw new MeshyRateLimitError(Number(res.headers.get('Retry-After') || '5') * 1000);
  }

  const text = await res.text();
  /** @type {Record<string, unknown>} */
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text.slice(0, 500) };
    }
  }

  if (res.status === 402) {
    const balance = Number(data?.balance);
    throw new MeshyInsufficientCreditsError(Number.isFinite(balance) ? balance : 0, 0);
  }

  if (!res.ok) {
    const msg =
      String(data?.message || data?.error || data?.detail || res.statusText || 'Meshy API error').slice(
        0,
        300,
      );
    throw new MeshyApiError(msg, res.status, data);
  }

  return data;
}

/**
 * GET /openapi/v1/balance
 * @param {any} env
 * @param {{ apiKey?: string | null } | null} [auth]
 */
export async function getBalance(env, auth = null) {
  const fetchOpts = auth?.apiKey ? { apiKey: auth.apiKey } : {};
  const data = await meshyFetch(env, '/openapi/v1/balance', { method: 'GET' }, fetchOpts);
  const balance = Number(data?.balance ?? data?.credits ?? 0);
  return {
    balance: Number.isFinite(balance) ? balance : 0,
    raw: data,
  };
}

/**
 * Throws MeshyInsufficientCreditsError when balance < estimatedCost.
 * @param {any} env
 * @param {number} estimatedCost
 * @param {{ apiKey?: string | null } | null} [auth]
 */
export async function checkBalance(env, estimatedCost, auth = null) {
  const required = Math.max(0, Number(estimatedCost) || 0);
  const { balance } = await getBalance(env, auth);
  if (balance < required) {
    throw new MeshyInsufficientCreditsError(balance, required);
  }
  return { balance, required, ok: true };
}

/** Alias used by CAD routes. */
export const checkMeshyBalance = checkBalance;

/**
 * @param {any} env
 * @param {string} operation
 * @param {Record<string, unknown>} [body]
 * @param {{ apiKey?: string | null } | null} [auth]
 */
export async function checkMeshyBalanceForOperation(env, operation, body = {}, auth = null) {
  const estimated = estimateMeshyOperationCost(operation, body);
  return checkMeshyBalance(env, estimated, auth);
}

function meshyAuthFetchOpts(auth) {
  return auth?.apiKey ? { apiKey: auth.apiKey } : {};
}

/**
 * @param {any} env
 * @param {string} taskType
 * @param {Record<string, unknown>} payload
 * @param {{ apiKey?: string | null } | null} [auth]
 */
export async function createMeshyTask(env, taskType, payload, auth = null) {
  const route = resolveMeshyTaskRoute(taskType);
  const data = await meshyFetch(env, route.base, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, meshyAuthFetchOpts(auth));
  const taskId = data?.result ?? data?.id ?? null;
  return { task_id: taskId != null ? String(taskId) : null, raw: data };
}

/**
 * @param {any} env
 * @param {string} taskType
 * @param {string} taskId
 * @param {{ apiKey?: string | null } | null} [auth]
 */
export async function getMeshyTask(env, taskType, taskId, auth = null) {
  const route = resolveMeshyTaskRoute(taskType);
  return meshyFetch(env, `${route.base}/${encodeURIComponent(taskId)}`, { method: 'GET' }, meshyAuthFetchOpts(auth));
}

/**
 * @param {any} env
 * @param {string} taskType
 * @param {string} taskId
 * @param {{ apiKey?: string | null } | null} [auth]
 */
export async function deleteMeshyTask(env, taskType, taskId, auth = null) {
  const route = resolveMeshyTaskRoute(taskType);
  return meshyFetch(env, `${route.base}/${encodeURIComponent(taskId)}`, { method: 'DELETE' }, meshyAuthFetchOpts(auth));
}

/**
 * GET /openapi/v1/animations/:id/stream (and other task types with SSE stream endpoints).
 * @param {any} env
 * @param {string} taskType
 * @param {string} taskId
 * @param {{ apiKey?: string | null } | null} [auth]
 */
export async function streamMeshyTask(env, taskType, taskId, auth = null) {
  const route = resolveMeshyTaskRoute(taskType);
  const key = auth?.apiKey ?? meshyApiKey(env);
  if (!key) throw new MeshyApiError('MESHYAI_API_KEY not configured', 503);

  const url = `${MESHY_API_ORIGIN}${route.base}/${encodeURIComponent(taskId)}/stream`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'text/event-stream',
    },
  });

  if (res.status === 429) {
    throw new MeshyRateLimitError(Number(res.headers.get('Retry-After') || '5') * 1000);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    /** @type {Record<string, unknown>} */
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text.slice(0, 500) };
      }
    }
    const msg = String(data?.message || data?.error || res.statusText || 'Meshy stream error').slice(0, 300);
    throw new MeshyApiError(msg, res.status, data);
  }

  return res;
}

/**
 * Build Meshy animation task payload (POST /openapi/v1/animations).
 * @param {Record<string, unknown>} body
 */
export function buildMeshyAnimationPayload(body) {
  const rigTaskId = String(body.rig_task_id || '').trim();
  const actionId = Number(body.action_id);
  if (!rigTaskId || !Number.isFinite(actionId)) {
    throw new Error('rig_task_id and action_id required');
  }

  /** @type {Record<string, unknown>} */
  const payload = { rig_task_id: rigTaskId, action_id: actionId };

  if (body.post_process != null && typeof body.post_process === 'object') {
    const pp = body.post_process;
    const op = String(pp.operation_type || '').trim();
    if (!op) throw new Error('post_process.operation_type required when post_process is set');
    const allowed = ['change_fps', 'fbx2usdz', 'extract_armature'];
    if (!allowed.includes(op)) {
      throw new Error(`invalid post_process.operation_type: ${op}`);
    }
    if (op === 'change_fps') {
      const fps = Number(pp.fps ?? 30);
      if (![24, 25, 30, 60].includes(fps)) {
        throw new Error('post_process.fps must be 24, 25, 30, or 60');
      }
      payload.post_process = { operation_type: 'change_fps', fps };
    } else {
      payload.post_process = { operation_type: op };
    }
  }

  return { payload, rigTaskId, actionId };
}

/**
 * Build Meshy rigging task payload (POST /openapi/v1/rigging).
 * @param {Record<string, unknown>} body
 */
export function buildMeshyRiggingPayload(body) {
  const inputTaskId = String(body.input_task_id || body.model_task_id || '').trim();
  const modelUrl = String(body.model_url || body.modelUrl || '').trim();
  if (!inputTaskId && !modelUrl) {
    throw new Error('input_task_id or model_url required');
  }

  /** @type {Record<string, unknown>} */
  const payload = {};
  if (inputTaskId) payload.input_task_id = inputTaskId;
  if (modelUrl) payload.model_url = modelUrl;

  const height = Number(body.height_meters);
  payload.height_meters = height > 0 ? height : 1.7;

  const textureImageUrl = String(body.texture_image_url || '').trim();
  if (textureImageUrl) payload.texture_image_url = textureImageUrl;

  return { payload, inputTaskId, modelUrl: modelUrl || null };
}

const MESHY_RETEXTURE_OPTIONAL_FIELDS = [
  'ai_model',
  'enable_original_uv',
  'enable_pbr',
  'hd_texture',
  'remove_lighting',
  'target_formats',
  'alpha_thumbnail',
];

/**
 * Build Meshy retexture task payload (POST /openapi/v1/retexture).
 * @param {Record<string, unknown>} body
 */
export function buildMeshyRetexturePayload(body) {
  const inputTaskId = String(body.input_task_id || body.model_task_id || '').trim();
  const modelUrl = String(body.model_url || body.modelUrl || '').trim();
  if (!inputTaskId && !modelUrl) {
    throw new Error('input_task_id or model_url required');
  }

  const textStyle = String(
    body.text_style_prompt || body.texture_prompt || body.prompt || '',
  ).trim();
  const imageStyle = String(body.image_style_url || body.imageStyleUrl || '').trim();
  if (!textStyle && !imageStyle) {
    throw new Error('text_style_prompt or image_style_url required');
  }

  /** @type {Record<string, unknown>} */
  const payload = {};
  if (inputTaskId) payload.input_task_id = inputTaskId;
  if (modelUrl) payload.model_url = modelUrl;
  if (textStyle) payload.text_style_prompt = textStyle.slice(0, 600);
  if (imageStyle) payload.image_style_url = imageStyle;

  for (const key of MESHY_RETEXTURE_OPTIONAL_FIELDS) {
    if (body[key] !== undefined && body[key] !== null) {
      payload[key] = body[key];
    }
  }

  return {
    payload,
    inputTaskId,
    modelUrl: modelUrl || null,
    textStyle: textStyle || null,
    imageStyle: imageStyle || null,
  };
}

/**
 * Build Meshy multi-color print payload (POST /openapi/v1/print/multi-color).
 * @param {Record<string, unknown>} body
 */
export function buildMeshyPrintMultiColorPayload(body) {
  const inputTaskId = String(body.input_task_id || body.model_task_id || '').trim();
  const modelUrl = String(body.model_url || body.modelUrl || '').trim();
  if (!inputTaskId && !modelUrl) {
    throw new Error('input_task_id or model_url required');
  }

  /** @type {Record<string, unknown>} */
  const payload = {};
  if (inputTaskId) payload.input_task_id = inputTaskId;
  if (modelUrl) payload.model_url = modelUrl;

  const maxColors = Number(body.max_colors ?? body.maxColors);
  if (Number.isFinite(maxColors)) {
    const n = Math.round(maxColors);
    if (n < 1 || n > 16) throw new Error('max_colors must be between 1 and 16');
    payload.max_colors = n;
  }

  const maxDepth = Number(body.max_depth ?? body.maxDepth);
  if (Number.isFinite(maxDepth)) {
    const n = Math.round(maxDepth);
    if (n < 3 || n > 6) throw new Error('max_depth must be between 3 and 6');
    payload.max_depth = n;
  }

  return { payload, inputTaskId, modelUrl: modelUrl || null };
}

const MESHY_IMAGE_TO_3D_OPTIONAL_FIELDS = [
  'model_type',
  'ai_model',
  'should_texture',
  'enable_pbr',
  'hd_texture',
  'texture_prompt',
  'texture_image_url',
  'should_remesh',
  'topology',
  'target_polycount',
  'decimation_mode',
  'save_pre_remeshed_model',
  'symmetry_mode',
  'pose_mode',
  'is_a_t_pose',
  'image_enhancement',
  'remove_lighting',
  'moderation',
  'target_formats',
  'auto_size',
  'alpha_thumbnail',
  'multi_view_thumbnails',
  'origin_at',
];

/**
 * Build Meshy image-to-3D task payload (POST /openapi/v1/image-to-3d).
 * @param {Record<string, unknown>} body
 */
export function buildMeshyImageTo3dPayload(body) {
  const inputTaskId = String(body.input_task_id || '').trim();
  const imageUrl = String(body.image_url || body.imageUrl || '').trim();
  if (!inputTaskId && !imageUrl) {
    throw new Error('image_url or input_task_id required');
  }

  /** @type {Record<string, unknown>} */
  const payload = {};
  if (inputTaskId) payload.input_task_id = inputTaskId;
  if (imageUrl) payload.image_url = imageUrl;

  for (const key of MESHY_IMAGE_TO_3D_OPTIONAL_FIELDS) {
    if (body[key] !== undefined && body[key] !== null) {
      payload[key] = body[key];
    }
  }

  const shouldTexture = payload.should_texture !== false;
  if (payload.enable_pbr === true && !shouldTexture) {
    throw new Error('enable_pbr requires should_texture to be true');
  }

  return { payload, inputTaskId, imageUrl: imageUrl || null };
}

/**
 * @param {any} env
 * @param {string} taskType
 * @param {{ page_num?: number; page_size?: number; sort_by?: string }} [query]
 * @param {{ apiKey?: string | null } | null} [auth]
 */
export async function listMeshyTasks(env, taskType, query = {}, auth = null) {
  const route = resolveMeshyTaskRoute(taskType);
  const qs = new URLSearchParams();
  if (query.page_num != null) qs.set('page_num', String(query.page_num));
  if (query.page_size != null) qs.set('page_size', String(query.page_size));
  if (query.sort_by) qs.set('sort_by', String(query.sort_by));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return meshyFetch(env, `${route.base}${suffix}`, { method: 'GET' }, meshyAuthFetchOpts(auth));
}

/**
 * Text-to-3D preview — POST /openapi/v2/text-to-3d
 * @param {any} env
 * @param {Record<string, unknown>} body
 * @param {{ apiKey?: string | null } | null} [auth]
 */
export async function textTo3dPreview(env, body, auth = null) {
  return createMeshyTask(env, 'text-to-3d', { ...body, mode: 'preview' }, auth);
}

/**
 * Text-to-3D refine — POST /openapi/v2/text-to-3d
 * @param {any} env
 * @param {Record<string, unknown>} body — must include preview_task_id
 * @param {{ apiKey?: string | null } | null} [auth]
 */
export async function textTo3dRefine(env, body, auth = null) {
  return createMeshyTask(env, 'text-to-3d', { ...body, mode: 'refine' }, auth);
}

/**
 * Map Meshy API error to HTTP status + body for Worker routes.
 * @param {unknown} err
 */
export function meshyErrorResponseBody(err) {
  if (err instanceof MeshyInsufficientCreditsError) {
    return {
      status: 402,
      body: {
        error: 'insufficient_credits',
        balance: err.balance,
        required: err.required,
        billing_url: 'https://www.meshy.ai/pricing',
      },
    };
  }
  if (err instanceof MeshyRateLimitError) {
    return {
      status: 429,
      body: {
        error: 'rate_limited',
        retry_after_ms: err.retryAfterMs,
        message: err.message,
      },
    };
  }
  if (err instanceof MeshyApiError) {
    return {
      status: err.status >= 400 && err.status < 600 ? err.status : 502,
      body: { error: err.message, meshy: err.body ?? null },
    };
  }
  return {
    status: 500,
    body: { error: String(err?.message || err) },
  };
}
