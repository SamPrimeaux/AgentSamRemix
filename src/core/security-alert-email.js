/**
 * Branded HTML security alert emails (Resend).
 * Each message goes only to auth_users.email for the same user_id as the open finding(s).
 */
import { getVaultSecrets, secretFromVault } from './vault.js';
import { insertEmailLog } from '../../backend/services/email/email-log.js';

const SECURITY_REVIEW_URL = 'https://inneranimalmedia.com/dashboard/settings/keys#security-findings';
const SECURITY_FROM = 'notifications@inneranimalmedia.com';
const AVATAR_URL =
  'https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/dbb316af-9c97-4959-f09f-bf58b2783d00/avatar';

/**
 * @param {number} openCount
 * @returns {string}
 */
export function buildSecurityAlertEmailHtml(openCount) {
  const count = Math.max(0, Math.floor(Number(openCount) || 0));
  const plural = count > 1 ? 's' : '';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Inner Animal Media Security Alert</title>
</head>
<body style="margin:0;padding:0;background:#0d0d10;font-family:Inter,ui-sans-serif,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d10;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#111116;border:1px solid rgba(255,255,255,0.10);border-radius:16px;overflow:hidden;max-width:100%;">
          
          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid rgba(255,255,255,0.06);">
              <img src="${AVATAR_URL}" 
                   alt="Inner Animal Media" width="48" height="48" style="display:block;" />
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 8px;color:#606071;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Security Alert</p>
              <h1 style="margin:0 0 16px;color:#e6e6f0;font-size:22px;font-weight:600;letter-spacing:-0.02em;">${count} open security finding${plural} detected</h1>
              <p style="margin:0 0 32px;color:#8a8a9e;font-size:15px;line-height:1.7;">
                Your Inner Animal Media workspace has security findings that require attention. 
                Review and resolve them in your dashboard.
              </p>
              
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-radius:10px;background:#5a7df7;">
                    <a href="${SECURITY_REVIEW_URL}" 
                       style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:-0.01em;">
                      Review Security Findings →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 28px;border-top:1px solid rgba(255,255,255,0.06);">
              <p style="margin:0;color:#606071;font-size:12px;line-height:1.6;">
                Sent by Inner Animal Media security monitoring · Do not reply to this email
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * @param {Record<string, unknown>} env
 * @param {string} tenantId
 * @param {string} [scopedUserId]
 * @returns {Promise<{ userId: string, email: string, openCount: number }[]>}
 */
export async function listOpenSecurityFindingEmailTargets(env, tenantId, scopedUserId = '') {
  if (!env?.DB || !tenantId) return [];
  const scope = scopedUserId != null ? String(scopedUserId).trim() : '';
  try {
    const res = await env.DB.prepare(
      `SELECT sf.user_id AS user_id,
              LOWER(TRIM(au.email)) AS email,
              COUNT(*) AS open_count
       FROM security_findings sf
       INNER JOIN auth_users au ON au.id = sf.user_id
       WHERE sf.tenant_id = ?
         AND sf.status = 'open'
         AND sf.user_id IS NOT NULL
         AND TRIM(sf.user_id) != ''
         AND au.email IS NOT NULL
         AND TRIM(au.email) != ''
         AND (? = '' OR sf.user_id = ?)
       GROUP BY sf.user_id`,
    )
      .bind(tenantId, scope, scope)
      .all();
    const out = [];
    for (const r of res?.results || []) {
      const userId = r?.user_id != null ? String(r.user_id).trim() : '';
      const email = r?.email != null ? String(r.email).trim().toLowerCase() : '';
      const openCount = Number(r?.open_count) || 0;
      if (!userId || !email.includes('@') || openCount <= 0) continue;
      out.push({ userId, email, openCount });
    }
    return out;
  } catch (e) {
    console.warn('[security-alert-email] targets query failed', e?.message ?? e);
    return [];
  }
}

/**
 * @param {Record<string, unknown>} env
 * @param {{ to: string, openFindingsCount: number }} opts
 */
export async function sendSecurityAlertHtmlToEmail(env, opts) {
  const to = opts.to != null ? String(opts.to).trim().toLowerCase() : '';
  const openFindingsCount = Number(opts.openFindingsCount) || 0;
  if (!to.includes('@') || openFindingsCount <= 0) {
    return { success: false, skipped: 'invalid_to_or_count' };
  }

  const vault = await getVaultSecrets(env);
  const key = secretFromVault(vault, env, 'RESEND_API_KEY');
  if (!key) {
    console.warn('[security-alert-email] RESEND_API_KEY not set');
    return { success: false, skipped: 'no_resend_key' };
  }

  const subject = 'Inner Animal Media — Security Alert';
  const html = buildSecurityAlertEmailHtml(openFindingsCount);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: SECURITY_FROM,
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.warn('[security-alert-email] Resend failed', to, res.status, t.slice(0, 200));
      return { success: false, error: t.slice(0, 200) };
    }
    const json = await res.json().catch(() => ({}));
    if (env.DB) {
      await insertEmailLog(env, {
        to,
        from: SECURITY_FROM,
        subject,
        status: 'sent',
        externalMessageId: json?.id ?? null,
        provider: 'resend',
      });
    }
    return { success: true, external_message_id: json?.id ?? null, provider: 'resend' };
  } catch (e) {
    console.warn('[security-alert-email] send failed', to, e?.message ?? e);
    return { success: false, error: e?.message ?? String(e) };
  }
}

/**
 * One HTML email per user with open findings (never cross-user).
 * @param {Record<string, unknown>} env
 * @param {{ tenantId: string, userId?: string }} opts
 */
export async function sendSecurityAlertHtmlEmails(env, opts) {
  const tenantId = opts.tenantId != null ? String(opts.tenantId).trim() : '';
  const userId = opts.userId != null ? String(opts.userId).trim() : '';
  const targets = await listOpenSecurityFindingEmailTargets(env, tenantId, userId);
  if (!targets.length) {
    return { sent: 0, skipped: 'no_recipients' };
  }

  let sent = 0;
  for (const { email, openCount } of targets) {
    const result = await sendSecurityAlertHtmlToEmail(env, {
      to: email,
      openFindingsCount: openCount,
    });
    if (result.success) sent += 1;
  }

  return { sent, recipients: targets.length };
}
