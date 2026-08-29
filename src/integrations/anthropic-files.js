/**
 * Anthropic Files API (beta files-api-2025-04-14).
 * Upload once → file_id; download only skill/code-execution outputs (downloadable: true).
 */
import Anthropic, { toFile } from '@anthropic-ai/sdk';
import { resolveApiKey } from '../core/vault.js';

export const ANTHROPIC_FILES_API_BETA = 'files-api-2025-04-14';

async function clientForUser(env, userId) {
  const apiKey = await resolveApiKey(env, userId, 'ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured for this user');
  return new Anthropic({ apiKey });
}

/**
 * @param {{ env: any, userId?: string|null, bytes: ArrayBuffer|Uint8Array|Blob, filename: string, mimeType?: string }} opts
 */
export async function uploadAnthropicFile(opts) {
  const { env, userId, bytes, filename, mimeType } = opts;
  const name = String(filename || '').trim();
  if (!name) throw new Error('filename required');
  const client = await clientForUser(env, userId);
  const file = await toFile(bytes, name, mimeType ? { type: mimeType } : undefined);
  return client.beta.files.upload({ file });
}

/** @param {{ env: any, userId?: string|null, fileId: string }} opts */
export async function retrieveAnthropicFileMetadata(opts) {
  const client = await clientForUser(opts.env, opts.userId);
  return client.beta.files.retrieveMetadata(String(opts.fileId || '').trim());
}

/**
 * Download generated file bytes (skills / code execution). Uploads are not downloadable.
 * @returns {Promise<{ metadata: any, bytes: Uint8Array }>}
 */
export async function downloadAnthropicFile(opts) {
  const fileId = String(opts.fileId || '').trim();
  if (!fileId) throw new Error('fileId required');
  const client = await clientForUser(opts.env, opts.userId);
  const metadata = await client.beta.files.retrieveMetadata(fileId);
  if (metadata?.downloadable === false) {
    throw new Error(`File ${fileId} is not downloadable (uploads cannot be downloaded)`);
  }
  const content = await client.beta.files.download(fileId);
  const ab = await content.arrayBuffer();
  return { metadata, bytes: new Uint8Array(ab) };
}

/** @param {{ env: any, userId?: string|null, limit?: number }} opts */
export async function listAnthropicFiles(opts = {}) {
  const client = await clientForUser(opts.env, opts.userId);
  const limit = opts.limit != null ? Number(opts.limit) : 20;
  return client.beta.files.list({ limit });
}

/** @param {{ env: any, userId?: string|null, fileId: string }} opts */
export async function deleteAnthropicFile(opts) {
  const client = await clientForUser(opts.env, opts.userId);
  return client.beta.files.delete(String(opts.fileId || '').trim());
}

/**
 * Collect file_ids from a Messages response (bash_code_execution outputs).
 * @param {{ content?: any[] }|null|undefined} message
 * @returns {string[]}
 */
export function extractAnthropicGeneratedFileIds(message) {
  const ids = [];
  const content = Array.isArray(message?.content) ? message.content : [];
  for (const block of content) {
    if (block?.type !== 'bash_code_execution_tool_result') continue;
    const inner = block.content;
    if (inner?.type !== 'bash_code_execution_result') continue;
    const outputs = Array.isArray(inner.content) ? inner.content : [];
    for (const out of outputs) {
      const id = out?.file_id != null ? String(out.file_id).trim() : '';
      if (id) ids.push(id);
    }
  }
  return [...new Set(ids)];
}

/** Document / image / container_upload blocks referencing a Files API id. */
export function anthropicFileDocumentBlock(fileId, extra = {}) {
  return {
    type: 'document',
    source: { type: 'file', file_id: String(fileId) },
    ...extra,
  };
}

export function anthropicFileImageBlock(fileId) {
  return {
    type: 'image',
    source: { type: 'file', file_id: String(fileId) },
  };
}

export function anthropicContainerUploadBlock(fileId) {
  return { type: 'container_upload', file_id: String(fileId) };
}
