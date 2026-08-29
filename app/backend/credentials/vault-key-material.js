/**
 * Platform key material for encrypting user credentials at rest in D1.
 *
 * Priority: VAULT_MASTER_KEY → VAULT_KEY (legacy)
 */

export const VAULT_KEY_ENV_NAMES = ['VAULT_MASTER_KEY', 'VAULT_KEY'];

/** @param {Record<string, unknown> | null | undefined} env */
export function getVaultKeyMaterial(env) {
  for (const name of VAULT_KEY_ENV_NAMES) {
    const v = String(env?.[name] ?? '').trim();
    if (v) return v;
  }
  return '';
}

/** @param {Record<string, unknown> | null | undefined} env */
export function isVaultConfigured(env) {
  return getVaultKeyMaterial(env) !== '';
}

export const VAULT_NOT_CONFIGURED_ERROR =
  'Vault encryption not configured. Set wrangler secret VAULT_MASTER_KEY.';

/** @param {Record<string, unknown> | null | undefined} env */
export function assertVaultConfigured(env) {
  if (!isVaultConfigured(env)) throw new Error(VAULT_NOT_CONFIGURED_ERROR);
}

export const VAULT_SETUP_HINT =
  'npx wrangler secret put VAULT_MASTER_KEY --name AgentSamRemix --config wrangler.jsonc';
