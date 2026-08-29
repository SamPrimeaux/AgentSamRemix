/**
 * Mandatory identity-plane provisioning before any browser session is minted.
 * Wraps provisionIdentitySignup via provisionAuthenticatedUser; idempotent.
 */
import { provisionIdentitySignup } from './provision-signup.js';
import { provisionAuthenticatedUser } from './provision-authenticated-user.js';
import { logAuthEvent } from './auth-events.js';

/**
 * @param {*} env
 * @param {Request} request
 * @param {{
 *   authUserId: string,
 *   email: string,
 *   name?: string,
 *   source?: string,
 *   provider?: string | null,
 *   providerSubject?: string | null,
 *   supabaseUserId?: string | null,
 *   passwordHash?: string | null,
 *   salt?: string | null,
 * }} identity
 */
export async function ensureIdentityPlaneBeforeSession(env, request, identity) {
  const authUserId = String(identity.authUserId || '').trim();
  const email = String(identity.email || '').toLowerCase().trim();
  if (!env?.DB || !authUserId || !email) {
    return { ok: false, reason: 'missing_identity', authUserId: authUserId || null };
  }

  const prov = await provisionAuthenticatedUser(env, request, {
    authUserId,
    email,
    name: identity.name,
    source: identity.source || identity.provider || 'unknown',
    provider: identity.provider ?? identity.source ?? null,
    providerSubject: identity.providerSubject ?? null,
    supabaseUserId: identity.supabaseUserId ?? null,
  });

  if (!prov?.ok) {
    return { ok: false, reason: prov?.reason ?? 'provision_failed', authUserId, tenantId: prov?.tenantId ?? null };
  }

  let accountRow = await env.DB.prepare(`SELECT id FROM accounts WHERE id = ? LIMIT 1`)
    .bind(authUserId)
    .first()
    .catch(() => null);

  if (!accountRow?.id) {
    const gap = await provisionIdentitySignup(env, {
      authUserId,
      email,
      name: identity.name,
      passwordHash: identity.passwordHash ?? undefined,
      salt: identity.salt ?? undefined,
      provider: identity.provider ?? identity.source ?? 'email',
      providerSubject: identity.providerSubject ?? null,
      supabaseUserId: identity.supabaseUserId ?? null,
      allowCreateAuthUser: false,
    });
    if (!gap?.ok) {
      await logAuthEvent(env, {
        request,
        eventType: 'workspace_provisioned',
        status: 'failed',
        userId: authUserId,
        metadata: { reason: 'accounts_gap_fill_failed', detail: gap?.reason ?? gap?.error },
      });
      return { ok: false, reason: gap?.reason ?? 'accounts_missing', authUserId };
    }
    accountRow = await env.DB.prepare(`SELECT id FROM accounts WHERE id = ? LIMIT 1`)
      .bind(authUserId)
      .first()
      .catch(() => null);
  }

  if (!accountRow?.id) {
    return { ok: false, reason: 'accounts_row_missing', authUserId };
  }

  return {
    ok: true,
    authUserId,
    tenantId: prov.tenantId ?? null,
    workspaceId: prov.workspaceId ?? null,
  };
}
