/**
 * Universal provisional file staging — R2 under conversation-scoped prefix.
 * Destination-agnostic: no files_source / fsa / github gate.
 * Ship is a separate tool (agentsam_ship_staged_file) — not this module.
 *
 * Key: staging/{workspace_id}/{conversation_id}/{normalized_rel_path}
 * Bucket: ASSETS / inneranimalmedia (same as sandbox helpers' default bucket name).
 */

import { normalizeR2Prefix } from '../../backend/agentsam/sandbox/r2-fuse-env.js';

const PREVIEW_MAX_CHARS = 32_000;
const STAGING_BUCKET = 'inneranimalmedia';

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeStageRelPath(raw) {
  let p = String(raw || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!p || p.includes('..') || p.startsWith('~/') || /^[a-zA-Z]:/.test(p)) {
    return '';
  }
  // Collapse // and strip trailing slash for file keys.
  p = p.replace(/\/+/g, '/').replace(/\/+$/, '');
  return p;
}

/**
 * @param {{ workspaceId: string, conversationId: string, path: string }} opts
 */
export function buildStagingR2Key(opts) {
  const ws = normalizeR2Prefix(opts.workspaceId);
  const conv = normalizeR2Prefix(opts.conversationId);
  const rel = normalizeStageRelPath(opts.path);
  if (!ws || !conv || !rel) return null;
  return `staging/${ws}/${conv}/${rel}`;
}

/**
 * @param {string} content
 * @param {string|null|undefined} mime
 */
function buildPreview(content, mime) {
  const m = String(mime || '').toLowerCase();
  const textish =
    !m ||
    m.startsWith('text/') ||
    m.includes('json') ||
    m.includes('javascript') ||
    m.includes('xml') ||
    m.includes('html') ||
    m.includes('markdown') ||
    m.includes('svg');
  if (!textish) {
    return { kind: 'binary', truncated: false, max_chars: PREVIEW_MAX_CHARS };
  }
  const s = String(content ?? '');
  const truncated = s.length > PREVIEW_MAX_CHARS;
  return {
    kind: 'text',
    text: truncated ? s.slice(0, PREVIEW_MAX_CHARS) : s,
    truncated,
    max_chars: PREVIEW_MAX_CHARS,
  };
}

/**
 * Guess mime from path when caller omits it.
 * @param {string} path
 * @param {string|null|undefined} mime
 */
function resolveMime(path, mime) {
  const explicit = String(mime || '').trim();
  if (explicit) return explicit;
  const lower = String(path || '').toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.css')) return 'text/css';
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'text/javascript';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'text/plain';
  if (lower.endsWith('.txt')) return 'text/plain';
  return 'text/plain';
}

/**
 * @param {any} env
 * @param {{
 *   path: string,
 *   content: string,
 *   mime?: string|null,
 *   workspaceId: string,
 *   conversationId: string,
 *   userId?: string|null,
 * }} input
 */
export async function stageFileToR2(env, input) {
  const path = normalizeStageRelPath(input.path);
  if (!path) {
    return {
      ok: false,
      error: 'invalid_path',
      detail: 'path must be a relative file path without ..',
    };
  }
  const workspaceId = String(input.workspaceId || '').trim();
  const conversationId = String(input.conversationId || '').trim();
  if (!workspaceId) {
    return { ok: false, error: 'workspace_id_required' };
  }
  if (!conversationId) {
    return { ok: false, error: 'conversation_id_required' };
  }
  if (input.content == null) {
    return { ok: false, error: 'content_required' };
  }
  const content = String(input.content);
  const key = buildStagingR2Key({ workspaceId, conversationId, path });
  if (!key) {
    return { ok: false, error: 'staging_key_build_failed' };
  }
  if (!env?.ASSETS?.put) {
    return { ok: false, error: 'ASSETS_R2_binding_missing' };
  }

  const mime = resolveMime(path, input.mime);
  let updated = false;
  try {
    const existing = await env.ASSETS.head(key);
    updated = Boolean(existing);
  } catch {
    updated = false;
  }

  const putResult = await env.ASSETS.put(key, content, {
    httpMetadata: { contentType: mime },
    customMetadata: {
      workspace_id: workspaceId,
      conversation_id: conversationId,
      path,
      staged_by: input.userId != null ? String(input.userId).trim() : '',
    },
  });

  const etag =
    putResult?.etag != null
      ? String(putResult.etag)
      : putResult?.httpEtag != null
        ? String(putResult.httpEtag)
        : null;

  const staged_ref = {
    bucket: STAGING_BUCKET,
    key,
    etag,
    path,
  };
  const size_bytes = new TextEncoder().encode(content).byteLength;
  const preview = buildPreview(content, mime);

  return {
    ok: true,
    staged_ref,
    size_bytes,
    mime,
    updated,
    preview,
    destination: null,
    message: updated
      ? `Updated staged file ${path} (not shipped).`
      : `Staged ${path} (not shipped — call ship when ready).`,
  };
}

/**
 * SSE payload for file_staged (present-step contract).
 * @param {Record<string, unknown>} stageResult
 * @param {{ conversationId: string, agentRunId?: string|null, toolCallId?: string|null }} meta
 */
export function fileStagedSsePayload(stageResult, meta) {
  if (!stageResult?.ok || !stageResult.staged_ref) return null;
  const ref = stageResult.staged_ref;
  return {
    type: 'file_staged',
    conversation_id: String(meta.conversationId || ''),
    agent_run_id: meta.agentRunId != null ? String(meta.agentRunId) : null,
    tool_call_id: meta.toolCallId != null ? String(meta.toolCallId) : null,
    path: String(ref.path || ''),
    mime: stageResult.mime != null ? String(stageResult.mime) : null,
    size_bytes: Number(stageResult.size_bytes) || 0,
    staged_ref: {
      bucket: String(ref.bucket || STAGING_BUCKET),
      key: String(ref.key || ''),
      etag: ref.etag != null ? String(ref.etag) : null,
      path: String(ref.path || ''),
    },
    preview: stageResult.preview || undefined,
    destination: null,
    updated: stageResult.updated === true,
  };
}
