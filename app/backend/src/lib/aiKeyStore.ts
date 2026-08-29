/**
 * Runtime-swappable AI provider key storage, backed by the shared
 * inneranimalmedia-business D1's user_secrets table (same table/columns the
 * main app already uses for API keys -- no new schema). Values are
 * AES-GCM encrypted at rest via secretsCrypto.ts.
 *
 * Resolution order for an active key: user's stored override in D1, else the
 * env.GEMINI_API_KEY wrangler secret (works out of the box), else none.
 * Storing a new key via setAiKey() takes effect on the very next request --
 * no redeploy, no wrangler secret put.
 */
import { encryptSecret, decryptSecret, last4 } from './secretsCrypto';

const SECRET_NAME = 'api_key';

export interface AiKeyStatus {
  configured: boolean;
  source: 'user' | 'default' | 'none';
  last4?: string;
  updatedAt?: number;
}

interface Env {
  DB: D1Database;
  SECRETS_ENCRYPTION_KEY?: string;
  GEMINI_API_KEY?: string;
}

async function findRow(env: Env, userId: string, service: string) {
  return env.DB.prepare(
    `SELECT id, secret_value_encrypted, updated_at FROM user_secrets
     WHERE user_id = ? AND service_name = ? AND secret_name = ? AND is_active = 1
     LIMIT 1`,
  )
    .bind(userId, service, SECRET_NAME)
    .first<{ id: string; secret_value_encrypted: string; updated_at: number }>();
}

/**
 * Resolve the actual key to use for a Gemini call: user override if present,
 * else the deploy-time default. Returns null if neither is configured.
 */
export async function resolveAiKey(env: Env, userId: string, service = 'gemini'): Promise<string | null> {
  if (env.SECRETS_ENCRYPTION_KEY) {
    const row = await findRow(env, userId, service);
    if (row) {
      try {
        return await decryptSecret(row.secret_value_encrypted, env.SECRETS_ENCRYPTION_KEY);
      } catch (e) {
        console.warn('[aiKeyStore] failed to decrypt stored key, falling back to default:', e);
      }
    }
  }
  return env.GEMINI_API_KEY || null;
}

/**
 * Report key status without ever returning the raw value.
 */
export async function getAiKeyStatus(env: Env, userId: string, service = 'gemini'): Promise<AiKeyStatus> {
  if (env.SECRETS_ENCRYPTION_KEY) {
    const row = await findRow(env, userId, service);
    if (row) {
      try {
        const plaintext = await decryptSecret(row.secret_value_encrypted, env.SECRETS_ENCRYPTION_KEY);
        return { configured: true, source: 'user', last4: last4(plaintext), updatedAt: row.updated_at };
      } catch {
        // fall through to default reporting below
      }
    }
  }
  if (env.GEMINI_API_KEY) {
    return { configured: true, source: 'default' };
  }
  return { configured: false, source: 'none' };
}

/**
 * Store (or replace) the user's key override. Effective immediately on the
 * next resolveAiKey() call -- no redeploy needed.
 */
export async function setAiKey(env: Env, userId: string, tenantId: string, plaintext: string, service = 'gemini'): Promise<void> {
  if (!env.SECRETS_ENCRYPTION_KEY) {
    throw new Error('secrets_encryption_not_configured');
  }
  const encrypted = await encryptSecret(plaintext, env.SECRETS_ENCRYPTION_KEY);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO user_secrets (
       id, user_id, tenant_id, secret_name, secret_value_encrypted, secret_type,
       description, service_name, is_active, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'api_key', ?, ?, 1, ?, ?)
     ON CONFLICT(user_id, secret_name, service_name) DO UPDATE SET
       secret_value_encrypted = excluded.secret_value_encrypted,
       is_active = 1,
       updated_at = excluded.updated_at`,
  )
    .bind(
      `usec_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
      userId,
      tenantId || 'system',
      SECRET_NAME,
      encrypted,
      `${service} API key set via AgentSamRemix settings`,
      service,
      now,
      now,
    )
    .run();
}

/**
 * Remove the user's override -- future calls fall back to the deploy-time default.
 */
export async function clearAiKey(env: Env, userId: string, service = 'gemini'): Promise<void> {
  await env.DB.prepare(
    `UPDATE user_secrets SET is_active = 0, updated_at = ? WHERE user_id = ? AND service_name = ? AND secret_name = ?`,
  )
    .bind(Math.floor(Date.now() / 1000), userId, service, SECRET_NAME)
    .run();
}
