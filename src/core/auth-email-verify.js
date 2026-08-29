/**
 * Email-password signup verification (Resend link). OAuth accounts are provider-verified.
 */

export function signupEmailVerificationEnabled(env) {
  return !!(env?.RESEND_API_KEY && String(env.RESEND_API_KEY).trim());
}

export async function loadEmailPasswordVerificationState(env, userId) {
  if (!env?.DB || !userId) {
    return { needsVerification: false, isOAuth: false, verified: true };
  }
  const row = await env.DB.prepare(
    `SELECT is_verified, password_hash FROM auth_users WHERE id = ? LIMIT 1`,
  )
    .bind(userId)
    .first()
    .catch(() => null);
  if (!row) return { needsVerification: false, isOAuth: false, verified: true };
  const isOAuth = row.password_hash === 'oauth';
  const verified = Number(row.is_verified) === 1;
  return {
    needsVerification: !isOAuth && !verified,
    isOAuth,
    verified,
  };
}

export async function userNeedsSignupEmailVerification(env, userId) {
  if (!signupEmailVerificationEnabled(env)) return false;
  const state = await loadEmailPasswordVerificationState(env, userId);
  return state.needsVerification;
}

/**
 * @param {*} env
 * @param {{ origin: string, email: string, authUserId: string }} opts
 * @returns {Promise<boolean>}
 */
export async function sendSignupVerificationEmail(env, opts) {
  const { origin, email, authUserId } = opts;
  if (!signupEmailVerificationEnabled(env) || !env.SESSION_CACHE) return false;

  const verifyToken = crypto.randomUUID();
  await env.SESSION_CACHE.put(
    `email_verify_${verifyToken}`,
    JSON.stringify({ email, authUserId }),
    { expirationTtl: 86400 },
  );

  const verifyUrl = `${origin.replace(/\/+$/, '')}/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`;
  const fromAddr =
    (env.RESEND_AUTH_FROM && String(env.RESEND_AUTH_FROM).trim()) ||
    'Inner Animal Media <auth@inneranimalmedia.com>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddr,
      to: [email],
      subject: 'Verify your Inner Animal Media account',
      html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">
        <h2 style="margin:0 0 12px">Welcome to Inner Animal Media</h2>
        <p style="line-height:1.5">Confirm your email to finish creating your account and open Agent Sam.</p>
        <p style="margin:24px 0"><a href="${verifyUrl}" style="display:inline-block;padding:12px 18px;background:#5a7df7;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Verify email</a></p>
        <p style="font-size:13px;color:#64748b">This link expires in 24 hours. If you did not sign up, you can ignore this email.</p>
      </div>`,
    }),
  }).catch((e) => {
    console.warn('[signup-verify-email] Resend:', e?.message);
    return null;
  });

  return !!res?.ok;
}
