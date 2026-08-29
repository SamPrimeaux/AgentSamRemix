/**
 * Supabase Auth HTTP Hooks — secured with AUTH_HOOK_SECRET (Bearer).
 * Configure in Supabase Dashboard → Authentication → Hooks → HTTPS endpoint.
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { sendResendEmail } from '../../backend/services/email/resend.js';
import { logAuthEvent } from '../../backend/identity/auth-events.js';
import { ensureAppUser } from '../../backend/identity/ensure-app-user.js';

function hookUnauthorized() {
  return jsonResponse({ error: 'Unauthorized' }, 401);
}

function isDisposableEmail(email) {
  const e = String(email || '').toLowerCase().trim();
  const d = e.split('@')[1] || '';
  if (e === 'meauxbility@gmail.com') return false;
  const block = new Set(['mailinator.com', 'guerrillamail.com', 'tempmail.com', 'yopmail.com']);
  return block.has(d);
}

/**
 * Send Email Hook — Supabase sends { user, email_data }.
 * Respond with { success: true } on send.
 */
async function handleSendEmailHook(request, env) {
  if (!verifyBridgeKey(request, env) && !verifyHookSecret(request, env)) {
    return hookUnauthorized();
  }
  const payload = await request.json().catch(() => ({}));
  const user = payload.user || {};
  const emailData = payload.email_data || {};
  const to = user.email || emailData.email;
  const subject =
    emailData.subject ||
    emailData.email_action_type ||
    'InnerAnimalMedia — sign in';
  const link =
    emailData.confirmation_url ||
    emailData.email_action_link ||
    emailData.magic_link ||
    emailData.recovery_link ||
    emailData.token_hash ||
    '';
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#0f172a">InnerAnimalMedia</h2>
      <p>Hello ${String(user.email || '').split('@')[0] || ''},</p>
      <p>Use the secure link below to continue. This link was requested for your account.</p>
      <p><a href="${String(link).replace(/"/g, '&quot;')}" style="display:inline-block;background:#0ea5e9;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Continue</a></p>
      <p style="color:#64748b;font-size:13px">If you did not request this, you can ignore this message.</p>
    </div>`;
  const out = await sendResendEmail(env, {
    to,
    subject: String(subject),
    html,
    tags: [{ name: 'auth_hook', value: 'send_email' }],
  });
  if (out.error) {
    console.warn('[auth-hook send-email]', out.error);
    await logAuthEvent(env, {
      request,
      eventType: 'auth_hook_send_email_failed',
      status: 'fail',
      metadata: { error: out.error },
    });
    return jsonResponse({ success: false, error: 'send_failed' }, 500);
  }
  return jsonResponse({ success: true });
}

async function resolvePlanForTenant(env, tenantId) {
  if (!tenantId || !env?.DB) return 'free';
  try {
    const r = await env.DB.prepare(`SELECT plan_id FROM billing_subscriptions WHERE tenant_id = ? LIMIT 1`)
      .bind(tenantId)
      .first();
    return r?.plan_id ? String(r.plan_id) : 'free';
  } catch {
    return 'free';
  }
}

/**
 * Custom Access Token — merge D1 app_user claims into JWT app_metadata.
 * Fail-open: on D1 errors or missing row, return incoming claims unchanged when possible.
 */
async function handleCustomAccessTokenHook(request, env) {
  if (!verifyHookSecret(request, env) && !verifyBridgeKey(request, env)) {
    return hookUnauthorized();
  }
  const payload = await request.json().catch(() => ({}));
  const user = payload.user || {};
  const email = String(user.email || '').toLowerCase().trim();
  const supabaseSub = user.id != null ? String(user.id).trim() : '';
  const baseClaims =
    payload.claims && typeof payload.claims === 'object' && !Array.isArray(payload.claims)
      ? { ...payload.claims }
      : {};
  const baseAppMeta =
    baseClaims.app_metadata && typeof baseClaims.app_metadata === 'object'
      ? { ...baseClaims.app_metadata }
      : {};

  const failOpen = () => jsonResponse({ claims: baseClaims });

  if (!email) {
    return failOpen();
  }

  const hookEnsure =
    String(env.AUTH_HOOK_ENSURE_APP_USER || 'true').toLowerCase() !== 'false';

  if (!env.DB) {
    return failOpen();
  }

  let row = null;
  try {
    if (supabaseSub) {
      row = await env.DB.prepare(
        `SELECT id, tenant_id, supabase_user_id, email FROM auth_users WHERE supabase_user_id = ? LIMIT 1`,
      )
        .bind(supabaseSub)
        .first();
    }
    if (!row?.id) {
      const { resolveAuthUserByEmail } = await import('../../backend/identity/users/index.js');
      row = await resolveAuthUserByEmail(env, email);
    }

    if (row?.id && supabaseSub) {
      const stored = row.supabase_user_id != null ? String(row.supabase_user_id).trim() : '';
      if (stored && stored !== supabaseSub) {
        return failOpen();
      }
    }

    if ((!row?.id || !String(row.id).trim()) && hookEnsure && supabaseSub) {
      try {
        const ensured = await ensureAppUser(
          env,
          {
            email,
            name:
              (user.user_metadata &&
                (user.user_metadata.full_name || user.user_metadata.name || user.user_metadata.display_name)) ||
              email.split('@')[0],
            supabaseUserId: supabaseSub,
            source: 'supabase_custom_access_token_hook',
          },
          { allowCreate: true },
        );
        if (ensured?.authUserId) {
          row = await env.DB.prepare(
            `SELECT id, tenant_id, supabase_user_id, email FROM auth_users WHERE id = ? LIMIT 1`,
          )
            .bind(ensured.authUserId)
            .first();
        }
      } catch (e) {
        console.warn('[auth-hook ensureAppUser]', e?.message ?? e);
      }
    }

    if (!row?.id) {
      return failOpen();
    }

    let ws = await env.DB.prepare(
      `SELECT w.id, wm.role FROM workspace_members wm JOIN workspaces w ON w.id = wm.workspace_id WHERE wm.user_id = ? ORDER BY wm.joined_at ASC LIMIT 1`,
    )
      .bind(row.id)
      .first();

    let plan = 'free';
    const tid = row.tenant_id != null ? String(row.tenant_id).trim() : '';
    if (tid) {
      plan = await resolvePlanForTenant(env, tid);
    }

    const app_metadata = {
      ...baseAppMeta,
      user_id: String(row.id),
      supabase_user_id: supabaseSub || (row.supabase_user_id != null ? String(row.supabase_user_id) : ''),
      tenant_id: tid || null,
      default_workspace_id: ws?.id || null,
      workspace_role: ws?.role || 'member',
      plan,
      auth_source: 'supabase',
    };
    delete app_metadata.is_superadmin;

    return jsonResponse({
      claims: {
        ...baseClaims,
        app_metadata,
      },
    });
  } catch (e) {
    console.warn('[auth-hook claims]', e?.message ?? e);
    return failOpen();
  }
}

/**
 * Before user created — block disposable / invite-only.
 */
async function handleBeforeUserCreatedHook(request, env) {
  if (!verifyHookSecret(request, env) && !verifyBridgeKey(request, env)) {
    return hookUnauthorized();
  }
  const payload = await request.json().catch(() => ({}));
  const rec = payload.record || payload.user || {};
  const email = String(rec.email || '').toLowerCase().trim();
  const mode = String(env.AUTH_SIGNUP_MODE || 'public').toLowerCase();
  if (mode === 'invite_only') {
    const invite = String(payload.invite_code || rec.invite_code || '').trim();
    const expected = String(env.AUTH_INVITE_CODE || '').trim();
    if (!expected || invite !== expected) {
      return jsonResponse({
        error: { message: 'Invite-only signup: invalid or missing invite code.' },
      }, 400);
    }
  }
  const blockDisp =
    String(env.AUTH_BLOCK_DISPOSABLE_EMAILS || '').toLowerCase() === 'true' ||
    String(env.AUTH_BLOCK_DISPOSABLE_EMAILS || '').toLowerCase() === '1';
  if (blockDisp && isDisposableEmail(email)) {
    return jsonResponse({ error: { message: 'This email provider is not allowed.' } }, 400);
  }
  const meta = {
    ...(rec.user_metadata && typeof rec.user_metadata === 'object' ? rec.user_metadata : {}),
    onboarding_status: 'new',
    source: 'supabase_auth',
    app: 'inneranimalmedia',
  };
  return jsonResponse({
    user_metadata: meta,
  });
}

function verifyHookSecret(request, env) {
  const path = new URL(request.url).pathname.toLowerCase();
  const secretMap = {
    '/api/auth-hooks/send-email': env.AUTH_HOOK_SECRET,
    '/api/auth-hooks/custom-access-token': env.AUTH_HOOK_SECRET_CAT || env.AUTH_HOOK_SECRET,
    '/api/auth-hooks/before-user-created': env.AUTH_HOOK_SECRET_BUC || env.AUTH_HOOK_SECRET,
  };
  const expected = secretMap[path] && String(secretMap[path]).trim();
  if (!expected) return false;
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const header = (request.headers.get('X-Auth-Hook-Secret') || '').trim();
  return bearer === expected || header === expected;
}

export async function handleAuthHooksApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.toLowerCase();
  const method = request.method.toUpperCase();
  if (method !== 'POST') return null;

  if (path === '/api/auth-hooks/send-email') {
    return handleSendEmailHook(request, env);
  }
  if (path === '/api/auth-hooks/custom-access-token') {
    return handleCustomAccessTokenHook(request, env);
  }
  if (path === '/api/auth-hooks/before-user-created') {
    return handleBeforeUserCreatedHook(request, env);
  }
  return null;
}
