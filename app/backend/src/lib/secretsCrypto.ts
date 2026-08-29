/**
 * AES-GCM encrypt/decrypt for values stored in user_secrets.secret_value_encrypted.
 * Native Web Crypto (crypto.subtle) -- no dependency, works in the Workers isolate
 * as-is. Keyed by SECRETS_ENCRYPTION_KEY, a one-time wrangler secret that never
 * needs to change again -- the values it protects (Gemini keys etc.) are what
 * get swapped at runtime via the /api/settings/ai-keys endpoints, not this key.
 */

const IV_BYTES = 12; // 96-bit IV, standard for AES-GCM

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Encrypt plaintext, returning a single base64 string: IV || ciphertext.
 */
export async function encryptSecret(plaintext: string, base64Key: string): Promise<string> {
  const key = await importKey(base64Key);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded));
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return toBase64(combined);
}

/**
 * Decrypt a value produced by encryptSecret.
 */
export async function decryptSecret(encoded: string, base64Key: string): Promise<string> {
  const key = await importKey(base64Key);
  const combined = fromBase64(encoded);
  const iv = combined.slice(0, IV_BYTES);
  const ciphertext = combined.slice(IV_BYTES);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

/**
 * Last 4 characters of a plaintext value, for display in settings UI without
 * ever returning the full secret to the client.
 */
export function last4(plaintext: string): string {
  return plaintext.length <= 4 ? plaintext : plaintext.slice(-4);
}
