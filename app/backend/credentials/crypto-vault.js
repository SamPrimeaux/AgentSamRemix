/**
 * Vault crypto helpers.
 *
 * IMPORTANT:
 * - Do not import AES keys directly from env bytes.
 * - Always derive a stable 256-bit AES-GCM key via HKDF so any-length env keys are valid.
 *
 * Key material: VAULT_MASTER_KEY → VAULT_KEY (see vault-key-material.js).
 */

import { getVaultKeyMaterial } from './vault-key-material.js';

export { getVaultKeyMaterial, isVaultConfigured, assertVaultConfigured, VAULT_NOT_CONFIGURED_ERROR } from './vault-key-material.js';

export async function getAESKey(env, usage = ['encrypt', 'decrypt']) {
  const material = getVaultKeyMaterial(env);
  if (!material) throw new Error('Vault key material not configured');

  const raw = new TextEncoder().encode(material);
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(16),
      info: new TextEncoder().encode('iam-vault-v1'),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

export async function aesGcmEncryptToB64(plaintext, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(String(plaintext ?? ''));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

export async function aesGcmDecryptFromB64(encryptedB64, key) {
  const combined = Uint8Array.from(atob(String(encryptedB64 || '')), (c) => c.charCodeAt(0));
  if (combined.length < 13) throw new Error('invalid encrypted payload');
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

