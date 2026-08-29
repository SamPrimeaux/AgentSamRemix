/**
 * IAM password reset via SDK identity recovery contract.
 * Hooks (user lookup, hash, D1 write) are injected by the Worker bridge.
 */
import { createPasswordResetService } from '@inneranimalmedia/agentsam-sdk/identity/recovery/password-reset';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadDefaultCompanyBranding(env) {
  if (!env?.DB) return { name: 'Inner Animal Media', supportEmail: 'hey@inneranimalmedia.com' };
  try {
    const row = await env.DB.prepare(
      `SELECT name, support_email FROM company WHERE slug = 'default' LIMIT 1`,
    ).first();
    return {
      name: row?.name || 'Inner Animal Media',
      supportEmail: row?.support_email || 'hey@inneranimalmedia.com',
    };
  } catch {
    return { name: 'Inner Animal Media', supportEmail: 'hey@inneranimalmedia.com' };
  }
}

/**
 * @param {Record<string, unknown>} env
 * @param {{
 *   findEligibleUser: (email: string) => Promise<{ id: string, email: string, name?: string } | null>,
 *   hashPassword: (password: string, saltHex?: string) => Promise<{ hashHex: string, saltHex: string }>,
 * }} hooks
 */
export function createIamPasswordResetService(env, hooks) {
  if (!env?.SESSION_CACHE) throw new Error('session_cache_required');
  const { findEligibleUser, hashPassword } = hooks;
  return createPasswordResetService({
    kv: env.SESSION_CACHE,
    findEligibleUser,
    hashPassword,
    updatePassword: async (userId, hashHex, saltHex) => {
      await env.DB.prepare(
        `UPDATE auth_users SET password_hash = ?, salt = ? WHERE id = ?`,
      ).bind(hashHex, saltHex, userId).run();
    },
    sendResetEmail: async ({ email, name, code }) => {
      if (!env.RESEND_API_KEY) {
        const err = new Error('email_not_configured');
        err.code = 'email_not_configured';
        throw err;
      }
      const brand = await loadDefaultCompanyBranding(env);
      const html = `<p>Hi ${escapeHtml(name)},</p><p>Your ${escapeHtml(brand.name)} verification code is:</p><p style="font-size:22px;font-weight:700;letter-spacing:4px;">${escapeHtml(code)}</p><p>Enter this on the reset page. Expires in 15 minutes.</p>`;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: `${brand.name} <${brand.supportEmail}>`,
          to: [email],
          subject: 'Your password reset code',
          html,
        }),
      });
    },
  });
}
