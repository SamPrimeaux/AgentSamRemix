/**
 * Composer multipart uploads (`files` / `images` in /api/agent/chat) → vision message blocks.
 * Default: ephemeral_vision — bytes forwarded to the model, never written to R2/D1.
 */

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)$/i;
/** Anthropic / OpenAI practical inline limit (~5 MB). */
export const MAX_CHAT_IMAGE_BYTES = 4_500_000;

export const IMAGE_HANDLING_MODES = Object.freeze({
  EPHEMERAL_VISION: 'ephemeral_vision',
  TEMPORARY_CONTEXT: 'temporary_context',
  PERSISTED_ASSET: 'persisted_asset',
});

export const VISION_ERROR_CODES = Object.freeze({
  NO_IMAGE_FILE_IN_REQUEST: 'NO_IMAGE_FILE_IN_REQUEST',
  IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
  UNSUPPORTED_IMAGE_MIME: 'UNSUPPORTED_IMAGE_MIME',
  MODEL_NOT_VISION_CAPABLE: 'MODEL_NOT_VISION_CAPABLE',
  PROVIDER_REJECTED_IMAGE: 'PROVIDER_REJECTED_IMAGE',
  VISION_ADAPTER_FAILED: 'VISION_ADAPTER_FAILED',
});

/** Vision providers reliably accept these inline. */
export const VISION_SUPPORTED_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

const PERSISTED_ASSET_INTENT_RE =
  /\b(save this|save to (the )?project|add to project|use as (the )?hero|add this to (the )?cms|store this as|attach this to|make this reusable|store as (a )?reference|use as asset)\b/i;
const TEMPORARY_CONTEXT_INTENT_RE =
  /\b(compare this image|keep this screenshot|use this as reference|reference for the next|keep (this|it) in context while)\b/i;

function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function guessImageMime(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.heic')) return 'image/heic';
  if (lower.endsWith('.heif')) return 'image/heif';
  return 'image/png';
}

function normalizeMime(raw, name) {
  const type = String(raw || '')
    .trim()
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (type && type.startsWith('image/')) return type === 'image/jpg' ? 'image/jpeg' : type;
  const guessed = guessImageMime(name);
  return guessed === 'image/jpg' ? 'image/jpeg' : guessed;
}

function visionError(code, message, detail = {}) {
  return { ok: false, code, message, detail, blocks: [] };
}

/** @param {unknown} file */
export function isChatImageUpload(file) {
  if (!file || typeof file !== 'object') return false;
  const type = String(file.type || '').trim();
  if (type && /^image\//i.test(type)) return true;
  return IMAGE_EXT_RE.test(String(file.name || ''));
}

/**
 * Merge multipart `files` and `images` fields from parsed chat body.
 * @param {Record<string, unknown>} body
 */
function uploadBlobSize(file) {
  if (!file || typeof file !== 'object') return 0;
  const n = Number(file.size ?? file.byteLength ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isUploadBlobLike(file) {
  if (!file || typeof file !== 'object') return false;
  return (
    typeof file.arrayBuffer === 'function' ||
    file instanceof ArrayBuffer ||
    file instanceof Uint8Array
  );
}

export function collectChatVisionUploadFiles(body) {
  const out = [];
  const seen = new Set();
  const push = (file, { trustImageField = false } = {}) => {
    if (!isUploadBlobLike(file)) return;
    const size = uploadBlobSize(file);
    // Workers formData() sometimes reports File.size === 0 for valid uploads when the client
    // sends multipart without explicit Content-Length per part, or when File metadata is lost
    // in the browser → Worker serialization boundary. Accept the blob as long as:
    //   - it arrived on the `images` field (trustImageField), OR
    //   - it has a recognized image MIME / extension
    // Size === 0 is re-checked after arrayBuffer() in parseChatVisionFiles — truly empty files
    // get rejected there with a clear NO_IMAGE_FILE_IN_REQUEST error.
    const id = `${String(file.name || '')}:${size}:${String(file.type || '')}`;
    if (seen.has(id)) return;
    const accepted = trustImageField
      ? isUploadBlobLike(file)   // trust the field — validate size/mime downstream
      : isChatImageUpload(file); // files field still requires image type/ext hint
    if (accepted) {
      seen.add(id);
      out.push(file);
    }
  };

  const imagesRaw = body?.images;
  const imagesArr = Array.isArray(imagesRaw) ? imagesRaw : imagesRaw != null ? [imagesRaw] : [];
  for (const file of imagesArr) {
    push(file, { trustImageField: true });
  }

  const filesRaw = body?.files;
  const filesArr = Array.isArray(filesRaw) ? filesRaw : filesRaw != null ? [filesRaw] : [];
  for (const file of filesArr) {
    push(file, { trustImageField: false });
  }
  return out;
}

/** @param {unknown} files */
export function chatUploadHasVisionImages(files) {
  if (Array.isArray(files)) return files.some(isChatImageUpload);
  return collectChatVisionUploadFiles(
    /** @type {Record<string, unknown>} */ ({ files, images: files }),
  ).length > 0;
}

/**
 * Resolve how attached images should be handled for this turn.
 * @param {Record<string, unknown>} body
 * @param {string} [message]
 */
export function resolveImageHandlingMode(body, message = '') {
  const explicit = String(
    body?.image_handling_mode ?? body?.imageHandlingMode ?? body?.image_mode ?? '',
  )
    .trim()
    .toLowerCase();
  if (explicit === IMAGE_HANDLING_MODES.TEMPORARY_CONTEXT) {
    return IMAGE_HANDLING_MODES.TEMPORARY_CONTEXT;
  }
  if (explicit === IMAGE_HANDLING_MODES.PERSISTED_ASSET) {
    return IMAGE_HANDLING_MODES.PERSISTED_ASSET;
  }
  if (explicit === IMAGE_HANDLING_MODES.EPHEMERAL_VISION) {
    return IMAGE_HANDLING_MODES.EPHEMERAL_VISION;
  }
  const msg = String(message || body?.message || '').trim();
  if (PERSISTED_ASSET_INTENT_RE.test(msg)) return IMAGE_HANDLING_MODES.PERSISTED_ASSET;
  if (TEMPORARY_CONTEXT_INTENT_RE.test(msg)) return IMAGE_HANDLING_MODES.TEMPORARY_CONTEXT;
  return IMAGE_HANDLING_MODES.EPHEMERAL_VISION;
}

/**
 * @param {unknown} files
 * @returns {Promise<{ ok: true, blocks: Array<{ type: 'image', source: { type: 'base64', media_type: string, data: string }, _filename?: string }> } | { ok: false, code: string, message: string, detail?: Record<string, unknown>, blocks: [] }>}
 */
export async function parseChatVisionFiles(files) {
  const arr = Array.isArray(files) ? files : [];
  // Accept blob-like objects even if MIME/ext metadata is absent — isChatImageUpload may
  // return false for Files whose type/name were lost in multipart serialization.
  // We verify actual bytes below after arrayBuffer().
  const imageCandidates = arr.filter((f) => isChatImageUpload(f) || isUploadBlobLike(f));
  if (!imageCandidates.length) {
    return visionError(
      VISION_ERROR_CODES.NO_IMAGE_FILE_IN_REQUEST,
      'No image file was found in the chat request. Attach PNG, JPEG, WebP, or GIF and try again.',
      { candidate_count: arr.length },
    );
  }

  const blocks = [];
  for (const file of imageCandidates) {
    let buf;
    try {
      if (typeof file.arrayBuffer === 'function') {
        buf = await file.arrayBuffer();
      } else if (file instanceof ArrayBuffer) {
        buf = file;
      } else if (file instanceof Uint8Array) {
        buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
      } else {
        return visionError(
          VISION_ERROR_CODES.VISION_ADAPTER_FAILED,
          'The attached image could not be read from the upload.',
          { name: file.name ?? null },
        );
      }
    } catch (e) {
      return visionError(
        VISION_ERROR_CODES.VISION_ADAPTER_FAILED,
        'The attached image could not be read from the upload.',
        { name: file.name ?? null, error: e?.message ?? String(e) },
      );
    }
    if (!buf || buf.byteLength === 0) {
      return visionError(
        VISION_ERROR_CODES.NO_IMAGE_FILE_IN_REQUEST,
        'The attached image file was empty.',
        {
          name: file.name ?? null,
          reported_size: uploadBlobSize(file),
          type: file.type ?? null,
        },
      );
    }
    if (buf.byteLength > MAX_CHAT_IMAGE_BYTES) {
      return visionError(
        VISION_ERROR_CODES.IMAGE_TOO_LARGE,
        `Image is too large (${Math.round(buf.byteLength / 1024)} KB). Maximum is ${Math.round(MAX_CHAT_IMAGE_BYTES / 1024)} KB.`,
        { name: file.name ?? null, bytes: buf.byteLength, max_bytes: MAX_CHAT_IMAGE_BYTES },
      );
    }
    const media_type = normalizeMime(file.type, file.name);
    if (!VISION_SUPPORTED_MIMES.has(media_type)) {
      return visionError(
        VISION_ERROR_CODES.UNSUPPORTED_IMAGE_MIME,
        `Unsupported image type (${media_type || 'unknown'}). Use PNG, JPEG, WebP, or GIF.`,
        { name: file.name ?? null, media_type },
      );
    }
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type,
        data: bytesToBase64(new Uint8Array(buf)),
      },
      _filename: String(file.name || 'image').trim() || 'image',
    });
  }
  return { ok: true, blocks };
}

/**
 * Back-compat wrapper — returns blocks only (empty array on failure).
 * @param {unknown} files
 */
export async function parseChatComposerImageBlocks(files) {
  const parsed = await parseChatVisionFiles(files);
  return parsed.ok ? parsed.blocks : [];
}

/**
 * @param {Record<string, unknown>} body
 * @param {{ message?: string, sessionId?: string|null, env?: any }} [opts]
 */
export async function resolveChatVisionUpload(body, opts = {}) {
  const uploadFiles = collectChatVisionUploadFiles(body);
  const mode = resolveImageHandlingMode(body, opts.message);
  if (!uploadFiles.length) {
    return { ok: true, blocks: [], mode, uploadFiles, error: null };
  }

  const parsed = await parseChatVisionFiles(uploadFiles);
  if (!parsed.ok) {
    return {
      ok: false,
      blocks: [],
      mode,
      uploadFiles,
      error: { code: parsed.code, message: parsed.message, detail: parsed.detail ?? {} },
    };
  }

  let blocks = parsed.blocks;
  if (
    mode === IMAGE_HANDLING_MODES.TEMPORARY_CONTEXT &&
    opts.env &&
    opts.sessionId &&
    blocks.length
  ) {
    const { storeTemporaryVisionImages } = await import('./chat-vision-temp-store.js');
    await storeTemporaryVisionImages(opts.env, opts.sessionId, blocks);
  }

  return { ok: true, blocks, mode, uploadFiles, error: null };
}

/** User-facing copy for vision error codes. */
export function visionErrorUserMessage(code, fallback) {
  const messages = {
    [VISION_ERROR_CODES.NO_IMAGE_FILE_IN_REQUEST]:
      'No image file arrived with your message. Re-attach the image and send again.',
    [VISION_ERROR_CODES.IMAGE_TOO_LARGE]:
      'That image is too large. Use PNG or JPEG under 4.5 MB.',
    [VISION_ERROR_CODES.UNSUPPORTED_IMAGE_MIME]:
      'That image format is not supported for vision. Use PNG, JPEG, WebP, or GIF.',
    [VISION_ERROR_CODES.MODEL_NOT_VISION_CAPABLE]:
      'The selected model cannot analyze images. Pick a vision-capable model or set Auto.',
    [VISION_ERROR_CODES.PROVIDER_REJECTED_IMAGE]:
      'The model provider rejected this image. Try a smaller PNG or JPEG.',
    [VISION_ERROR_CODES.VISION_ADAPTER_FAILED]:
      'Could not prepare the image for the vision model. Re-attach and try again.',
  };
  return messages[code] || fallback || messages[VISION_ERROR_CODES.VISION_ADAPTER_FAILED];
}

/**
 * @param {string} message
 * @param {Array<{ type: string, source?: { type?: string, media_type?: string, data?: string }, _filename?: string }>} imageBlocks
 */
export function buildVisionUserMessage(message, imageBlocks) {
  const text = String(message || '').trim() || 'The user attached image(s) for you to analyze.';
  const textBlock = { type: 'text', text };
  const images = (imageBlocks || []).map(({ _filename, ...block }) => block);
  return {
    role: 'user',
    content: [textBlock, ...images],
  };
}

/**
 * @param {Array<{ role?: string, content?: unknown }>} chatMessages
 * @param {string} fallbackText
 * @param {Awaited<ReturnType<typeof parseChatComposerImageBlocks>>} imageBlocks
 */
export function applyVisionBlocksToChatMessages(chatMessages, fallbackText, imageBlocks) {
  const next = Array.isArray(chatMessages) ? [...chatMessages] : [];
  const built = buildVisionUserMessage(fallbackText, imageBlocks);
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i]?.role === 'user') {
      next[i] = built;
      return next;
    }
  }
  next.push(built);
  return next;
}

/** @param {unknown} content */
export function userMessageHasVisionContent(content) {
  return (
    Array.isArray(content) &&
    content.some((b) => b && typeof b === 'object' && b.type === 'image' && b.source?.data)
  );
}

/** @param {Array<{ role?: string, content?: unknown }>} chatMessages */
export function chatMessagesHaveVisionUpload(chatMessages) {
  return (Array.isArray(chatMessages) ? chatMessages : []).some(
    (m) => m?.role === 'user' && userMessageHasVisionContent(m.content),
  );
}

/**
 * Map provider / model resolution failures to vision error codes.
 * @param {unknown} err
 */
export function mapVisionProviderError(err) {
  const code = err?.code != null ? String(err.code) : '';
  const msg = String(err?.message || err || '').toLowerCase();
  if (code === 'CAPABILITY_MISMATCH' || /no vision|vision.capable|supports_vision/.test(msg)) {
    return VISION_ERROR_CODES.MODEL_NOT_VISION_CAPABLE;
  }
  if (/image.*(invalid|rejected|unsupported|too large)|content_policy|moderation/.test(msg)) {
    return VISION_ERROR_CODES.PROVIDER_REJECTED_IMAGE;
  }
  return VISION_ERROR_CODES.VISION_ADAPTER_FAILED;
}
