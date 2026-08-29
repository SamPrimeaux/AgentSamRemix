import crypto from "crypto";
import { getDatabase } from "../db/database";
import { packEncryptedToken, unpackEncryptedToken, sanitizeForTelemetry } from "./crypto";
import { resolveUserId } from "./auth";

export interface VaultSecretRecord {
  id: string;
  user_id: string;
  tenant_id: string;
  secret_name: string;
  secret_type: string;
  service_name: string | null;
  is_active: number;
  usage_count: number;
  last_used_at: number | null;
  created_at: number;
}

/**
 * Enterprise Secret Vault Access Layer (D1 / SQLite backed).
 * Encrypts all values using AES-256-GCM prior to storage in `user_secrets`.
 */
export async function getVaultSecret(
  userId?: string,
  secretName: string = "GEMINI_API_KEY",
  serviceName: string = "google"
): Promise<string | null> {
  const effectiveUserId = await resolveUserId(userId);
  const db = await getDatabase();

  // 1. Check if the encrypted secret is in user_secrets
  const res = await db.query(
    `SELECT secret_value_encrypted, is_active FROM user_secrets 
     WHERE user_id = ? AND secret_name = ? AND (service_name = ? OR service_name IS NULL)
     LIMIT 1`,
    [effectiveUserId, secretName, serviceName]
  );

  if (res.results && res.results.length > 0) {
    const row = res.results[0] as { secret_value_encrypted: string; is_active: number };
    if (row.is_active === 0) {
      console.warn(`[Vault] Secret ${secretName} for user ${effectiveUserId} is currently inactive.`);
      return null;
    }

    try {
      const decrypted = unpackEncryptedToken(row.secret_value_encrypted);
      
      // Update usage metadata
      await db.query(
        `UPDATE user_secrets 
         SET usage_count = usage_count + 1, last_used_at = unixepoch() 
         WHERE user_id = ? AND secret_name = ?`,
        [effectiveUserId, secretName]
      );

      return decrypted;
    } catch (err) {
      console.error(`[Vault] Decryption failure for secret ${secretName}:`, (err as Error).message);
      return null;
    }
  }

  // 2. If not found in user_secrets, check process.env to auto-seed into vault
  const envVal = process.env[secretName] || (secretName === "GEMINI_API_KEY" ? process.env.GOOGLE_AI_API_KEY : undefined);
  if (envVal) {
    console.log(`[Vault] Seeding environment secret '${secretName}' into encrypted user_secrets table for user '${effectiveUserId}'...`);
    await setVaultSecret({
      userId: effectiveUserId,
      tenantId: "tenant_default",
      secretName,
      secretValue: envVal,
      secretType: "api_key",
      serviceName,
      description: `Auto-seeded from system environment`,
    });
    return envVal;
  }

  return null;
}

/**
 * Stores a secret into user_secrets encrypted with AES-256-GCM.
 */
export async function setVaultSecret(params: {
  userId?: string;
  tenantId?: string;
  secretName: string;
  secretValue: string;
  secretType?: string;
  serviceName?: string;
  description?: string;
}): Promise<{ id: string }> {
  const effectiveUserId = await resolveUserId(params.userId);
  const db = await getDatabase();
  const id = "sec_" + crypto.randomBytes(8).toString("hex");
  const encryptedValue = packEncryptedToken(params.secretValue);
  const tenantId = params.tenantId || "tenant_default";
  const secretType = params.secretType || "api_key";
  const serviceName = params.serviceName || "google";
  const description = params.description || `Encrypted secret for ${serviceName}`;

  await db.query(
    `INSERT INTO user_secrets (
      id, user_id, tenant_id, secret_name, secret_value_encrypted,
      secret_type, description, service_name, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, unixepoch(), unixepoch())
    ON CONFLICT(user_id, secret_name, service_name) DO UPDATE SET
      secret_value_encrypted = excluded.secret_value_encrypted,
      description = excluded.description,
      is_active = 1,
      updated_at = unixepoch()`,
    [id, effectiveUserId, tenantId, params.secretName, encryptedValue, secretType, description, serviceName]
  );

  return { id };
}

/**
 * Lists metadata for all secrets in user_secrets for a given user without exposing ciphertext or plaintext.
 */
export async function listVaultSecrets(userId?: string): Promise<VaultSecretRecord[]> {
  const effectiveUserId = await resolveUserId(userId);
  const db = await getDatabase();
  const res = await db.query(
    `SELECT id, user_id, tenant_id, secret_name, secret_type, service_name, is_active, usage_count, last_used_at, created_at
     FROM user_secrets 
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [effectiveUserId]
  );
  return (res.results || []) as unknown as VaultSecretRecord[];
}

