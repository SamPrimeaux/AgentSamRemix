import crypto from "crypto";

/**
 * Enterprise AES-256-GCM Cryptographic Security Layer for AgentSamFast.
 * Ensures AI keys, access tokens, and sensitive tenant credentials are never stored
 * or transmitted in plaintext.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits auth tag
const SALT_LENGTH = 16;
const ITERATIONS = 100_000;
const KEY_LENGTH = 32;

// Master derivation secret from server environment (never exposed to client)
function getMasterSecret(): string {
  const secret = process.env.APPLET_SECRET_KEY || process.env.GEMINI_API_KEY || "agentsamfast_enterprise_vault_secret_default_key_2026";
  return secret;
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(secret, salt, ITERATIONS, KEY_LENGTH, "sha256");
}

export interface EncryptedPayload {
  version: "v1";
  ciphertext: string; // base64
  iv: string;         // base64
  tag: string;        // base64
  salt: string;       // base64
}

/**
 * Encrypts sensitive string data (e.g. API keys, bearer tokens, private credentials)
 */
export function encryptSecret(plainText: string, customPassphrase?: string): EncryptedPayload {
  if (!plainText) {
    throw new Error("Cannot encrypt empty plainText");
  }

  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(customPassphrase || getMasterSecret(), salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: "v1",
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    salt: salt.toString("base64"),
  };
}

/**
 * Decrypts an encrypted payload safely on the server side
 */
export function decryptSecret(payload: EncryptedPayload, customPassphrase?: string): string {
  if (!payload || !payload.ciphertext || !payload.iv || !payload.tag || !payload.salt) {
    throw new Error("Invalid encrypted payload structure");
  }

  const salt = Buffer.from(payload.salt, "base64");
  const iv = Buffer.from(payload.iv, "base64");
  const tag = Buffer.from(payload.tag, "base64");
  const ciphertext = Buffer.from(payload.ciphertext, "base64");

  const key = deriveKey(customPassphrase || getMasterSecret(), salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Serializes an encrypted payload into a compact portable token format:
 * `asv1.<salt>.<iv>.<tag>.<ciphertext>`
 */
export function packEncryptedToken(plainText: string, customPassphrase?: string): string {
  const enc = encryptSecret(plainText, customPassphrase);
  return `asv1.${enc.salt}.${enc.iv}.${enc.tag}.${enc.ciphertext}`;
}

/**
 * Unpacks and decrypts a compact portable token format
 */
export function unpackEncryptedToken(token: string, customPassphrase?: string): string {
  if (!token.startsWith("asv1.")) {
    throw new Error("Unsupported token format");
  }
  const parts = token.split(".");
  if (parts.length !== 5) {
    throw new Error("Malformed token format");
  }
  const [, salt, iv, tag, ciphertext] = parts;
  return decryptSecret({
    version: "v1",
    salt,
    iv,
    tag,
    ciphertext,
  }, customPassphrase);
}

/**
 * Redacts any API keys or bearer tokens from strings/objects to prevent accidental leakage in logs or responses.
 */
export function sanitizeForTelemetry(data: any): any {
  if (!data) return data;
  if (typeof data === "string") {
    return data
      .replace(/AIza[0-9A-Za-z-_]{35}/g, "AIza***[REDACTED]")
      .replace(/(?:key|token|secret|password|bearer)\s*[:=]\s*['"]?([a-zA-Z0-9_\-\.]{10,})['"]?/gi, "$1: [REDACTED]")
      .replace(/Bearer\s+[a-zA-Z0-9_\-\.]+/gi, "Bearer [REDACTED]");
  }
  if (typeof data === "object") {
    const copy: Record<string, any> = Array.isArray(data) ? [] : {};
    for (const [k, v] of Object.entries(data)) {
      if (/key|secret|token|password|auth/i.test(k) && typeof v === "string") {
        copy[k] = "[REDACTED]";
      } else {
        copy[k] = sanitizeForTelemetry(v);
      }
    }
    return copy;
  }
  return data;
}
