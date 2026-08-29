// guard-dup-allow: backend/browser domain peel from src/core (residual closeout)
/**
 * Merge user BYOK R2 credentials into env for browser capture save (S3 SigV4).
 */
import { loadUserR2Credentials } from '../../credentials/cloudflare/r2-credentials.js';

/**
 * @param {any} env
 * @param {{ id?: string, user_id?: string } | null | undefined} authUser
 */
export async function mergeR2S3EnvFromUserStorage(env, authUser) {
  if (!env) return env;
  const userId = String(authUser?.id || authUser?.user_id || '').trim();
  const userCreds = userId ? await loadUserR2Credentials(env, userId) : null;
  if (userCreds) {
    return {
      ...env,
      R2_ACCESS_KEY_ID: userCreds.accessKeyId,
      R2_SECRET_ACCESS_KEY: userCreds.secretAccessKey,
      CLOUDFLARE_ACCOUNT_ID: userCreds.cfAccountId || env.CLOUDFLARE_ACCOUNT_ID,
    };
  }
  return {
    ...env,
    R2_ACCESS_KEY_ID: undefined,
    R2_SECRET_ACCESS_KEY: undefined,
  };
}
