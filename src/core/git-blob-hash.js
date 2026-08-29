/**
 * Git blob object-ID helpers for Merkle leaf domains.
 * git_blob_sha1 = SHA-1("blob <len>\0" || bytes) — matches GitHub Trees blob SHAs.
 */

function asBytes(content) {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  throw new Error('git_blob_bytes_required');
}

function hexFromDigest(digest) {
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {string | Uint8Array | ArrayBuffer} content
 * @returns {Promise<string>} 40-char lowercase hex SHA-1
 */
export async function gitBlobSha1Hex(content) {
  if (!globalThis.crypto?.subtle) throw new Error('git_blob_webcrypto_unavailable');
  const bytes = asBytes(content);
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const combined = new Uint8Array(header.byteLength + bytes.byteLength);
  combined.set(header, 0);
  combined.set(bytes, header.byteLength);
  const digest = await globalThis.crypto.subtle.digest('SHA-1', combined);
  return hexFromDigest(digest);
}

/**
 * @param {string | Uint8Array | ArrayBuffer} content
 * @returns {Promise<string>} 64-char lowercase hex SHA-256 of git blob framing
 */
export async function gitBlobSha256Hex(content) {
  if (!globalThis.crypto?.subtle) throw new Error('git_blob_webcrypto_unavailable');
  const bytes = asBytes(content);
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const combined = new Uint8Array(header.byteLength + bytes.byteLength);
  combined.set(header, 0);
  combined.set(bytes, header.byteLength);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', combined);
  return hexFromDigest(digest);
}
