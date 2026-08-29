/**
 * oauth-crypto.js — pure OAuth crypto/PKCE primitives, no MCP coupling.
 *
 * Extracted 2026-08-22 from src/api/mcp-oauth-shared.js, which despite its name held
 * these as generic, MCP-agnostic functions -- misplaced under an MCP-named file made
 * them unreachable from backend/identity/identity-oauth-provider.js (the identity
 * OAuth path) without an upward dependency-law violation (backend importing
 * worker-composition). This is the "shared" layer (rank 1) home they should have had
 * from the start: both worker-composition (src/api/mcp-oauth-shared.js re-exports
 * these for backward compatibility) and backend/ (identity-oauth-provider.js) may
 * import shared/ freely.
 */

export function mcpOAuthNow() {
  return Math.floor(Date.now() / 1000);
}

export function mcpOAuthBase64Url(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function mcpOAuthSha256Hex(value) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function mcpOAuthPkceS256(value) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return mcpOAuthBase64Url(buf);
}

export function mcpOAuthRandomToken(prefix, bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  const hex = Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}
