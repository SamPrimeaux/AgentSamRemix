/**
 * Normalize Workers AI image model responses into bytes + MIME.
 *
 * Flux (`@cf/black-forest-labs/flux-1-schnell`) returns `{ image: "<base64>" }`
 * (JPEG). Older / other models may return ArrayBuffer / Uint8Array / ReadableStream.
 * Never pass a plain object to `new Uint8Array(...)` — that yields length 0 and
 * blank R2 "PNGs".
 */

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function sniffImageContentType(bytes) {
  if (!bytes || bytes.byteLength < 3) return 'application/octet-stream';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
    return 'image/webp';
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return 'application/octet-stream';
}

/**
 * @param {string} b64
 * @returns {Uint8Array}
 */
function decodeBase64ToBytes(b64) {
  const raw = String(b64 || '').trim();
  if (!raw) throw new Error('workers_ai_image: empty base64 image field');
  const stripped = raw.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
  const binary = atob(stripped);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * @param {unknown} result — env.AI.run(...) return value
 * @param {{ fallbackContentType?: string }} [opts]
 * @returns {Promise<{ bytes: Uint8Array, contentType: string }>}
 */
export async function extractWorkersAiImageBytes(result, opts = {}) {
  const fallbackCt =
    opts.fallbackContentType != null && String(opts.fallbackContentType).trim()
      ? String(opts.fallbackContentType).trim()
      : 'image/jpeg';

  let bytes = null;

  if (result instanceof ArrayBuffer) {
    bytes = new Uint8Array(result);
  } else if (ArrayBuffer.isView(result) && result.buffer) {
    bytes = new Uint8Array(result.buffer, result.byteOffset, result.byteLength);
  } else if (result && typeof result === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (result);
    if (typeof obj.image === 'string') {
      bytes = decodeBase64ToBytes(obj.image);
    } else if (obj.image instanceof ArrayBuffer) {
      bytes = new Uint8Array(obj.image);
    } else if (ArrayBuffer.isView(obj.image)) {
      const v = /** @type {ArrayBufferView} */ (obj.image);
      bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    } else if (typeof obj.image_base64 === 'string') {
      bytes = decodeBase64ToBytes(obj.image_base64);
    } else if (typeof ReadableStream !== 'undefined' && result instanceof ReadableStream) {
      const ab = await new Response(result).arrayBuffer();
      bytes = new Uint8Array(ab);
    }
  }

  if (!bytes || bytes.byteLength === 0) {
    const shape =
      result == null
        ? 'null'
        : Array.isArray(result)
          ? 'array'
          : typeof result === 'object'
            ? `object keys=${Object.keys(/** @type {object} */ (result)).slice(0, 8).join(',')}`
            : typeof result;
    throw new Error(
      `workers_ai_image: empty or undecodable image bytes (${shape}) — refusing to upload`,
    );
  }

  const sniffed = sniffImageContentType(bytes);
  const contentType = sniffed !== 'application/octet-stream' ? sniffed : fallbackCt;
  return { bytes, contentType };
}
