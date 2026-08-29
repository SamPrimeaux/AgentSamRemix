import { provisionIdentitySignup } from './provision-signup.js';
import { ensureUserTerminalConnection } from './provisioning/terminal.js';
import { logAuthEvent } from './auth-events.js';

/**
 * Idempotent post-auth provisioning: identity plane batch + legacy billing/onboarding hooks.
 * Call after every successful signup/login once canonical auth_users.id is known.
 *
 * @param {*} env
 * @param {Request} request
 * @param {{
 *   authUserId: string,
 *   email: string,
 *   name?: string,
 *   source?: string,
 *   supabaseUserId?: string | null,
 *   provider?: string | null,
 *   providerSubject?: string | null,
 * }} identity
 */
export async function provisionAuthenticatedUser(env, request, identity) {
  const authUserId = String(identity.authUserId || '').trim();
  const email = String(identity.email || '').toLowerCase().trim();
  const name = String(identity.name || email.split('@')[0] || 'User').trim();
  const source = String(identity.source || 'unknown').trim();

  if (!env?.DB || !authUserId || !email) {
    return { ok: false, authUserId: authUserId || null, tenantId: null };
  }

  let tenantId = null;
  try {
    const row = await env.DB.prepare(`SELECT tenant_id FROM auth_users WHERE id = ? LIMIT 1`).bind(authUserId).first();
    tenantId = row?.tenant_id ?? null;
  } catch {
    /* ignore */
  }

  await logAuthEvent(env, {
    request,
    eventType: 'auth_provision_started',
    tenantId,
    userId: authUserId,
    provider: source,
    metadata: { email_domain: email.includes('@') ? email.split('@')[1] : null },
  });

  const prov = await provisionIdentitySignup(env, {
    authUserId,
    email,
    name,
    source,
    provider: identity.provider ?? source,
    providerSubject: identity.providerSubject ?? null,
    supabaseUserId: identity.supabaseUserId ?? null,
    allowCreateAuthUser: false,
  });

  if (!prov?.ok) {
    await logAuthEvent(env, {
      request,
      eventType: 'workspace_provisioned',
      status: 'failed',
      tenantId,
      userId: authUserId,
      provider: source,
      metadata: { error: prov?.reason ?? 'provisionIdentitySignup_failed' },
    });
    return {
      ok: false,
      reason: prov?.reason ?? 'provisionIdentitySignup_failed',
      authUserId,
      tenantId: prov?.tenantId ?? tenantId,
      workspaceId: prov?.workspaceId ?? null,
    };
  }

  tenantId = prov.tenantId ?? tenantId;

  try {
    await ensureUserTerminalConnection(env, authUserId);
  } catch (e) {
    console.warn('[provisionAuthenticatedUser] ensureUserTerminalConnection', e?.message ?? e);
  }

  await logAuthEvent(env, {
    request,
    eventType: 'workspace_provisioned',
    status: 'ok',
    tenantId: prov.tenantId ?? tenantId,
    userId: authUserId,
    provider: source,
    metadata: { workspace_id: prov.workspaceId ?? null, provisioned: prov.provisioned ?? false },
  });

  return {
    ok: true,
    authUserId,
    tenantId: prov.tenantId ?? tenantId,
    workspaceId: prov.workspaceId ?? null,
  };
}
