/**
 * IAM ports for SDK createFinalizeInboundOAuth — D1/session wiring only.
 */
import { normalizeLoginSessionResult } from '../auth/session-cookies.js';
import { AUTH_COOKIE_NAME } from '../auth/constants.js';
import { resolveTenantAtLogin } from './users/tenant.js';
import {
  createLoginSession,
  revokeAuthSession,
  resolveSessionIdFromCookieValue,
} from './sessions/write.js';
import { ensureAppUser } from './ensure-app-user.js';
import { ensureIdentityPlaneBeforeSession } from './ensure-identity-plane.js';
import { resolveCanonicalWorkspace } from './workspace-resolve.js';
import { isMcpOAuthLoginChallengeResumePath } from './oauth-login-path.js';
import {
  createFinalizeInboundOAuth,
  createOAuthRedirectHelpers,
} from '@inneranimalmedia/agentsam-sdk/identity/oauth/callback';

const redirectHelpers = createOAuthRedirectHelpers({
  authCookieName: AUTH_COOKIE_NAME,
  isAllowedLoginResumePath: isMcpOAuthLoginChallengeResumePath,
  resolveSessionIdFromCookie: resolveSessionIdFromCookieValue,
  revokeAuthSession,
});

export const {
  revokeIncomingCookieSession,
  safeDashboardLoginRedirectPath,
  oauthPostLoginGlobeRedirectUrl,
} = redirectHelpers;

async function updateUserNameIfEmpty(env, authUserId, name) {
  const nm = await env.DB.prepare(`SELECT name FROM auth_users WHERE id = ? LIMIT 1`)
    .bind(authUserId)
    .first();
  if (!nm?.name || !String(nm.name).trim()) {
    await env.DB.prepare(`UPDATE auth_users SET name = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(name, authUserId)
      .run();
  }
}

async function runPostLoginD1Effects(env, ctx) {
  const { provider, authUserId, sessionId, tenantId, workspaceId, pageContext } = ctx;
  const sessionDate = new Date().toISOString().slice(0, 10);
  try {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO work_sessions (
        session_id, user_id, tenant_id, workspace_id,
        started_at, last_activity_at, page_context
      ) VALUES (?, ?, ?, ?, unixepoch(), unixepoch(), ?)
    `).bind(
      sessionId,
      authUserId,
      tenantId ?? null,
      workspaceId ?? null,
      pageContext,
    ).run();
  } catch (e) {
    console.warn(`[finalizeInboundOAuth/${provider}] work_sessions insert failed`, e?.message ?? e);
  }
  await env.DB.prepare(`
    UPDATE auth_sessions
    SET workspace_id = ?, work_session_id = ?
    WHERE id = ?
  `).bind(
    workspaceId ?? null,
    sessionId,
    sessionId,
  ).run().catch(() => {});
  await env.DB.prepare(`
    UPDATE time_entries
    SET ended_at = unixepoch(),
        hours = MAX(0, (unixepoch() - COALESCE(started_at, created_at, unixepoch())) / 3600.0),
        updated_at = unixepoch()
    WHERE user_id = ? AND ended_at IS NULL
  `).bind(authUserId).run().catch(() => {});
  await env.DB.prepare(`
    INSERT INTO time_entries
      (user_id, tenant_id, workspace_id, description,
       source, work_session_id, started_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'auto', ?, unixepoch(), unixepoch(), unixepoch())
  `).bind(
    authUserId,
    tenantId ?? null,
    workspaceId ?? null,
    'Login session — ' + sessionDate,
    sessionId,
  ).run().catch(() => {});
  await env.DB.prepare(`
    INSERT INTO agentsam_analytics
      (tenant_id, workspace_id, period, period_date,
       total_sessions, computed_at)
    VALUES (?, ?, 'session', ?, 1, unixepoch())
    ON CONFLICT(tenant_id, workspace_id, period, period_date)
    DO UPDATE SET
      total_sessions = total_sessions + 1,
      computed_at = unixepoch()
  `).bind(
    tenantId ?? null,
    workspaceId ?? null,
    sessionDate,
  ).run().catch(() => {});
  const existingProfile = await env.DB.prepare(
    `SELECT id FROM agentsam_subagent_profile WHERE user_id = ? LIMIT 1`,
  ).bind(authUserId).first().catch(() => null);
  if (!existingProfile) {
    await env.DB.prepare(`
      INSERT INTO agentsam_subagent_profile
        (id, user_id, workspace_id, tenant_id, slug,
         display_name, description, icon, agent_type,
         personality_tone, is_active, is_platform_global)
      VALUES (
        'sub_' || lower(hex(randomblob(8))),
        ?, ?, ?, 'agent-sam',
        'Agent Sam', 'Default AI assistant', 'robot',
        'assistant', 'professional', 1, 0
      )
    `).bind(
      authUserId,
      workspaceId ?? '',
      tenantId ?? null,
    ).run().catch(() => {});
  }
}

const iamInboundOAuthPorts = {
  hasDatabase: (env) => Boolean(env?.DB),
  ensureAppUser,
  updateUserNameIfEmpty,
  ensureIdentityPlaneBeforeSession,
  revokeIncomingCookieSession,
  createLoginSession,
  normalizeLoginSessionResult,
  resolveTenantAtLogin,
  resolveCanonicalWorkspace,
  runPostLoginD1Effects,
  logWarn: (tag, message, meta) => console.warn(`[${tag}]`, message, meta ?? ''),
  logError: (tag, message, meta) => console.error(`[${tag}]`, message, meta ?? ''),
};

export const finalizeInboundOAuth = createFinalizeInboundOAuth(iamInboundOAuthPorts);
