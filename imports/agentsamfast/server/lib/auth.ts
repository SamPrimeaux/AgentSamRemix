import crypto from "crypto";
import { getDatabase } from "../db/database";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  tenant_id: string | null;
  is_superadmin: number;
  status: string;
  active_tenant_id: string | null;
  active_workspace_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  account_type: string;
  plan: string;
  created_at: string;
  updated_at: string;
}

export interface AuthSession {
  id: string;
  user_id: string;
  expires_at: string;
  created_at: string;
  tenant_id: string | null;
  workspace_id: string | null;
  revoked_at: string | null;
  type: string;
}

/**
 * Enterprise Auth & Identity Manager
 * Ensures all operations use opaque unique user IDs (e.g., usr_...) rather than exposing raw emails in code.
 */
export async function getOrCreateUser(params?: {
  email?: string;
  name?: string;
  tenantId?: string;
}): Promise<AuthUser> {
  const db = await getDatabase();
  const email = params?.email || process.env.DEFAULT_USER_EMAIL || "system@local.internal";
  const name = params?.name || "AgentSam Operator";
  const tenantId = params?.tenantId || "tenant_default";

  // Check if user already exists by email
  const res = await db.query<AuthUser>(
    `SELECT * FROM auth_users WHERE email = ? LIMIT 1`,
    [email]
  );

  if (res.results && res.results.length > 0) {
    return res.results[0];
  }

  // Create new user with opaque ID and secure salt/hash
  const userId = "usr_" + crypto.randomBytes(8).toString("hex");
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = crypto.pbkdf2Sync("ephemeral_secure_pass", salt, 10000, 32, "sha256").toString("hex");

  await db.query(
    `INSERT INTO auth_users (
      id, email, name, password_hash, salt, tenant_id, is_superadmin,
      is_verified, status, active_tenant_id, active_workspace_id,
      display_name, role, account_type, plan, meta_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?, 1,
      1, 'active', ?, 'workspace_default',
      ?, 'admin', 'human', 'enterprise', '{}'
    )`,
    [userId, email, name, passwordHash, salt, tenantId, tenantId, name]
  );

  const newUser = await db.query<AuthUser>(
    `SELECT * FROM auth_users WHERE id = ? LIMIT 1`,
    [userId]
  );

  return newUser.results[0];
}

/**
 * Resolves user identity from opaque ID, email, or active default user.
 * Guarantees a safe, opaque user_id is returned without exposing identities.
 */
export async function resolveUserId(identifier?: string): Promise<string> {
  if (!identifier) {
    const defaultUser = await getOrCreateUser();
    return defaultUser.id;
  }

  // If already an opaque user ID format
  if (identifier.startsWith("usr_") || identifier.startsWith("user_")) {
    return identifier;
  }

  const db = await getDatabase();
  const res = await db.query<{ id: string }>(
    `SELECT id FROM auth_users WHERE id = ? OR email = ? LIMIT 1`,
    [identifier, identifier]
  );

  if (res.results && res.results.length > 0) {
    return res.results[0].id;
  }

  // If user passed a custom email or identity, auto-provision and return the opaque ID
  const user = await getOrCreateUser({ email: identifier });
  return user.id;
}

/**
 * Create a new session in auth_sessions for an authenticated user
 */
export async function createAuthSession(userId: string, metadata?: {
  ipAddress?: string;
  userAgent?: string;
  tenantId?: string;
  workspaceId?: string;
}): Promise<AuthSession> {
  const db = await getDatabase();
  const sessionId = "sess_" + crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  const tenantId = metadata?.tenantId || "tenant_default";
  const workspaceId = metadata?.workspaceId || "workspace_default";

  await db.query(
    `INSERT INTO auth_sessions (
      id, user_id, expires_at, created_at, ip_address, user_agent,
      tenant_id, workspace_id, type
    ) VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, 'cli_or_api')`,
    [sessionId, userId, expiresAt, metadata?.ipAddress || null, metadata?.userAgent || null, tenantId, workspaceId]
  );

  return {
    id: sessionId,
    user_id: userId,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
    tenant_id: tenantId,
    workspace_id: workspaceId,
    revoked_at: null,
    type: "cli_or_api"
  };
}
