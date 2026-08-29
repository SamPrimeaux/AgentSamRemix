/**
 * Locked purpose/source enums for media_assets.metadata_json (ticket proof, MCP, etc.).
 * Identity (workspace/user/tenant) is never taken from tool args — callers pass scope from auth.
 */

import { normalizeTags } from './r2-image-metadata.js';

export const MEDIA_ASSET_PURPOSES = Object.freeze([
  'ticket_proof',
  'chat_attach',
  'cms_asset',
  'moviemode',
  'design_studio',
  'general',
]);

export const MEDIA_ASSET_SOURCES = Object.freeze([
  'agent_sam',
  'mcp_oauth',
  'dashboard',
  'browser_capture',
  'api',
]);

/**
 * @param {unknown} raw
 * @param {string} [fallback='general']
 */
export function resolveMediaPurpose(raw, fallback = 'general') {
  const v = String(raw || '').trim().toLowerCase();
  if (MEDIA_ASSET_PURPOSES.includes(v)) return v;
  return MEDIA_ASSET_PURPOSES.includes(fallback) ? fallback : 'general';
}

/**
 * @param {unknown} raw
 * @param {string} [fallback='api']
 */
export function resolveMediaSource(raw, fallback = 'api') {
  const v = String(raw || '').trim().toLowerCase();
  if (MEDIA_ASSET_SOURCES.includes(v)) return v;
  return MEDIA_ASSET_SOURCES.includes(fallback) ? fallback : 'api';
}

/**
 * Infer MEDIA_ASSET_SOURCES from agent/MCP runContext.surface.
 * @param {Record<string, unknown>} [runContext]
 */
export function resolveMediaSourceFromContext(runContext = {}) {
  const surface = String(runContext.surface || runContext.client || runContext.source || '')
    .trim()
    .toLowerCase();
  if (surface.includes('chatgpt') || surface.includes('claude') || surface.includes('mcp')) {
    return 'mcp_oauth';
  }
  if (surface.includes('dashboard')) return 'dashboard';
  if (surface.includes('browser')) return 'browser_capture';
  if (surface.includes('agent') || !surface) return 'agent_sam';
  return 'api';
}

/**
 * @param {string|null|undefined} contentType
 * @param {string|null|undefined} [filename]
 * @returns {'image'|'video'|'audio'|'text'|'binary'|'unknown'}
 */
export function resolveMediaKind(contentType, filename) {
  const ct = String(contentType || '').trim().toLowerCase();
  const name = String(filename || '').trim().toLowerCase();
  if (ct.startsWith('image/') || /\.(avif|webp|jpe?g|png|gif|svg)$/.test(name)) return 'image';
  if (ct.startsWith('video/') || /\.(mp4|webm|mov)$/.test(name)) return 'video';
  if (ct.startsWith('audio/')) return 'audio';
  if (ct.startsWith('text/') || /\.(py|js|ts|tsx|md|json|css|html|sql)$/.test(name)) return 'text';
  if (ct && ct !== 'application/octet-stream') return 'binary';
  if (/\.(zip|pdf|glb|bin)$/.test(name)) return 'binary';
  return 'unknown';
}

/**
 * @param {{
 *   ticket_id?: string|null,
 *   purpose?: unknown,
 *   source?: unknown,
 *   tags?: unknown,
 *   cf_images_id?: string|null,
 *   label?: string|null,
 *   extra?: Record<string, unknown>,
 *   require_ticket_id?: boolean,
 * }} input
 */
export function buildMediaAssetMetadataJson(input = {}) {
  const purpose = resolveMediaPurpose(input.purpose, 'general');
  const source = resolveMediaSource(input.source, 'api');
  const tags = normalizeTags(input.tags);
  if (purpose === 'ticket_proof' && !tags.includes('ticket-proof')) {
    tags.unshift('ticket-proof');
  }
  /** @type {Record<string, unknown>} */
  const out = {
    iam_tags: tags,
    purpose,
    source,
    ticket_id: input.ticket_id != null && String(input.ticket_id).trim()
      ? String(input.ticket_id).trim()
      : null,
    cf_images_id:
      input.cf_images_id != null && String(input.cf_images_id).trim()
        ? String(input.cf_images_id).trim()
        : null,
  };
  if (input.label != null && String(input.label).trim()) {
    out.label = String(input.label).trim().slice(0, 160);
  }
  if (input.extra && typeof input.extra === 'object') {
    for (const [k, v] of Object.entries(input.extra)) {
      if (v !== undefined && !(k in out)) out[k] = v;
    }
  }
  // Hard-fail only when attach path sets require_ticket_id: true.
  if (input.require_ticket_id === true && purpose === 'ticket_proof' && !out.ticket_id) {
    const err = new Error('ticket_id_required_for_ticket_proof');
    err.code = 'ticket_id_required_for_ticket_proof';
    throw err;
  }
  return out;
}
