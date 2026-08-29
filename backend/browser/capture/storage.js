/**
 * Browser capture storage policy — platform R2 only when explicitly scoped.
 * Default: ephemeral (SESSION_CACHE) + optional user save (BYOK R2, Google Drive, local download).
 */
import { IAM_ASSETS_PUBLIC_ORIGIN, agentScreenshotR2Key } from './r2-paths.js';
import { mergeR2S3EnvFromUserStorage } from './byok-env.js';
import { r2PutViaBindingOrS3 } from './r2-s3-put.js';
import { resolveGoogleDriveAccessToken } from './integration-oauth.js';

const CAPTURE_CACHE_TTL = 3600;

export function shouldPersistCaptureToPlatformR2(opts = {}) {
  if (opts.persist === 'platform' || opts.persistPlatform === true) return true;
  if (String(opts.scope || '').trim() === 'platform') return true;
  const meta = opts.metadata && typeof opts.metadata === 'object' ? opts.metadata : {};
  if (meta.scope === 'platform' || meta.platform_persist === true) return true;
  if (opts.jobType === 'quality_report' && (meta.scope === 'platform' || opts.scope === 'platform')) {
    return true;
  }
  return false;
}

function bytesToBase64(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function buildEphemeralCaptureResult(buf, contentType, captureId) {
  const id = captureId || crypto.randomUUID();
  const ct = contentType || 'image/png';
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const image_base64 = bytesToBase64(u8);
  return {
    storage: 'ephemeral',
    capture_id: id,
    content_type: ct,
    byte_length: u8.byteLength,
    image_base64,
    data_url: `data:${ct};base64,${image_base64}`,
    download_filename: `capture-${id.slice(0, 8)}.png`,
    save_hint: 'Use POST /api/browser/captures/save to persist to your R2, Google Drive, or download locally.',
  };
}

export async function cacheEphemeralCapture(env, captureId, payload) {
  if (!env?.SESSION_CACHE || !captureId) return false;
  try {
    await env.SESSION_CACHE.put(`browser_capture:${captureId}`, JSON.stringify(payload), {
      expirationTtl: CAPTURE_CACHE_TTL,
    });
    return true;
  } catch {
    return false;
  }
}

export async function loadEphemeralCapture(env, captureId) {
  if (!env?.SESSION_CACHE || !captureId) return null;
  try {
    const raw = await env.SESSION_CACHE.get(`browser_capture:${captureId}`, 'json');
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Agent/browser screenshot — platform R2 only when policy allows; else ephemeral.
 * @param {any} env
 * @param {ArrayBuffer|Uint8Array} buf
 * @param {string} [contentType]
 * @param {{ persist?: string, scope?: string, metadata?: object, jobType?: string }} [opts]
 */
export async function resolveBrowserScreenshotCapture(env, buf, contentType, opts = {}) {
  const ct = contentType || 'image/png';

  if (shouldPersistCaptureToPlatformR2(opts)) {
    const bucket = env.ASSETS || env.R2;
    if (!bucket) throw new Error('ASSETS R2 bucket required for platform capture persist');
    const id = crypto.randomUUID();
    const key = agentScreenshotR2Key(id);
    await bucket.put(key, buf, { httpMetadata: { contentType: ct } });
    return {
      storage: 'platform_r2',
      screenshot_url: `${IAM_ASSETS_PUBLIC_ORIGIN}/${key}`,
      r2_key: key,
      job_id: id,
    };
  }

  const capture = buildEphemeralCaptureResult(buf, ct);
  await cacheEphemeralCapture(env, capture.capture_id, {
    content_type: ct,
    image_base64: capture.image_base64,
    byte_length: capture.byte_length,
    created_at: Date.now(),
  });
  return {
    ...capture,
    screenshot_url: capture.data_url,
    result_url: capture.data_url,
  };
}

/** @deprecated use resolveBrowserScreenshotCapture */
export async function putAgentBrowserScreenshotToR2(env, buf, contentType, opts = {}) {
  return resolveBrowserScreenshotCapture(env, buf, contentType, opts);
}

async function exportBytesToGoogleDrive(env, userId, { bytes, contentType, filename }) {
  const bearer = await resolveGoogleDriveAccessToken(env, userId);
  if (!bearer) {
    return { ok: false, error: 'Google Drive not connected. Connect in Settings → Integrations.' };
  }

  const meta = JSON.stringify({ name: filename, mimeType: contentType });
  const boundary = '-------IAMCaptureBoundary';
  const enc = new TextEncoder();
  const part1 = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`);
  const part2 = enc.encode(`--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`);
  const closing = enc.encode(`\r\n--${boundary}--`);
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const merged = new Uint8Array(part1.length + part2.length + u8.length + closing.length);
  merged.set(part1, 0);
  merged.set(part2, part1.length);
  merged.set(u8, part1.length + part2.length);
  merged.set(closing, part1.length + part2.length + u8.length);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': `multipart/related; boundary="${boundary}"`,
    },
    body: merged,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    return { ok: false, error: `Google Drive upload failed (${res.status}): ${err.slice(0, 200)}` };
  }
  const data = await res.json();
  return {
    ok: true,
    file_id: data.id,
    web_view_link: `https://drive.google.com/file/d/${data.id}/view`,
  };
}

/**
 * Save a cached or inline capture to user-chosen destination.
 * @param {any} env
 * @param {object} authUser
 * @param {{ capture_id?: string, image_base64?: string, content_type?: string, filename?: string, destination: string, dest_bucket?: string, dest_key?: string }} body
 */
export async function saveBrowserCaptureForUser(env, authUser, body) {
  const destination = String(body.destination || '').trim().toLowerCase();
  if (!['byok_r2', 'google_drive', 'local'].includes(destination)) {
    return { ok: false, error: 'destination must be byok_r2, google_drive, or local' };
  }

  let imageBase64 = body.image_base64 != null ? String(body.image_base64) : '';
  let contentType = String(body.content_type || 'image/png');
  if (body.capture_id && !imageBase64) {
    const cached = await loadEphemeralCapture(env, String(body.capture_id).trim());
    if (!cached?.image_base64) return { ok: false, error: 'Capture not found or expired' };
    imageBase64 = cached.image_base64;
    contentType = cached.content_type || contentType;
  }
  if (!imageBase64) return { ok: false, error: 'capture_id or image_base64 required' };

  const binary = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
  const filename = String(body.filename || body.download_filename || `capture-${Date.now()}.png`).trim();

  if (destination === 'local') {
    return {
      ok: true,
      destination: 'local',
      content_type: contentType,
      filename,
      image_base64: imageBase64,
      byte_length: binary.byteLength,
    };
  }

  const userId = String(authUser?.id || authUser?.user_id || '').trim();
  if (!userId) return { ok: false, error: 'Unauthorized' };

  if (destination === 'google_drive') {
    const out = await exportBytesToGoogleDrive(env, userId, {
      bytes: binary,
      contentType,
      filename,
    });
    return out.ok ? { ok: true, destination: 'google_drive', ...out } : out;
  }

  const userEnv = await mergeR2S3EnvFromUserStorage(env, authUser);
  if (!userEnv.R2_ACCESS_KEY_ID || !userEnv.R2_SECRET_ACCESS_KEY) {
    return { ok: false, error: 'Connect Cloudflare R2 keys in Storage settings (BYOK) first.' };
  }
  const destBucket = String(body.dest_bucket || body.bucket || '').trim();
  if (!destBucket) return { ok: false, error: 'dest_bucket required for byok_r2' };
  const destKey =
    String(body.dest_key || body.key || '').trim() ||
    `quality-reports/captures/${filename}`;

  const ok = await r2PutViaBindingOrS3(userEnv, null, destBucket, destKey, binary, contentType);
  if (!ok) return { ok: false, error: 'Upload to your R2 bucket failed' };
  return {
    ok: true,
    destination: 'byok_r2',
    bucket: destBucket,
    key: destKey,
    byte_length: binary.byteLength,
  };
}
