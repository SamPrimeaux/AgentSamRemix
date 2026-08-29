/**
 * Minimal vault decrypt for integration OAuth tokens (browser capture export path).
 */

const VAULT_KEY_ENV_NAMES = ['VAULT_MASTER_KEY', 'VAULT_KEY'];

function getVaultKeyMaterial(env) {
  for (const name of VAULT_KEY_ENV_NAMES) {
    const v = String(env?.[name] ?? '').trim();
    if (v) return v;
  }
  return '';
}

async function getAESKey(env, usage = ['decrypt']) {
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

async function aesGcmDecryptFromB64(encryptedB64, key) {
  const combined = Uint8Array.from(atob(String(encryptedB64 || '')), (c) => c.charCodeAt(0));
  if (combined.length < 13) throw new Error('invalid encrypted payload');
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

/** @param {any} env @param {string} encryptedB64 */
export async function decryptOAuthTokenCiphertext(env, encryptedB64) {
  const key = await getAESKey(env, ['decrypt']);
  return aesGcmDecryptFromB64(encryptedB64, key);
}
