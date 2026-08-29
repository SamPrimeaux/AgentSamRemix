/**
 * Runtime-neutral SHA-256 helper for Worker/Node code.
 * Keep generic crypto below product/backend domains so low-level callers do not
 * depend upward on CMS or another product owner.
 * @param {string | Uint8Array} input
 */
export async function sha256Hex(input) {
  const buf = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto SHA-256 unavailable');
  }
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
