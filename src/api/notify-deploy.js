/**
 * POST /api/notify/deploy-complete
 * Internal: sends Resend emails with Meet link after production deploy.
 * Auth: AGENTSAM_BRIDGE_KEY (X-Internal-Secret or Bearer).
 * Must go through sendPlatformEmail so email_logs + Resend ids stay honest.
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { sendPlatformEmail } from '../lib/email.js';
import {
  recordPhoneLoopDeploymentNotification,
  resolvePhoneLoopDeploymentId,
} from '../core/email-agent-bridge.js';

const DEFAULT_MEET_URL = 'https://inneranimalmedia.com/dashboard/meet';

function deployEmailHtml(meetUrl) {
  return `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#f8fafc;padding:28px 24px 36px;max-width:560px;margin:0 auto;">
  <div style="font-size:22px;font-weight:700;color:#0d9488;letter-spacing:-0.02em;margin-bottom:6px;">Inner Animal Media</div>
  <div style="font-size:13px;color:#94a3b8;margin-bottom:20px;">Deploy Notification · Live session</div>
  <p style="margin:0 0 12px;font-size:16px;">Production is live.</p>
  <p style="color:#94a3b8;font-size:13px;margin:0 0 22px;">The latest build deployed successfully. Join the live session now.</p>
  <a href="${meetUrl}" style="display:inline-block;padding:12px 28px;background:#0d9488;color:#f8fafc;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">Join Live Session →</a>
  <p style="margin:18px 0 0;color:#64748b;font-size:11px;word-break:break-all;">${meetUrl}</p>
  <div style="margin-top:28px;padding-top:18px;border-top:1px solid #1e293b;">
    <img src="https://imagedelivery.net/g7wf09fCONpnidkRnR_5vw/238de9d1-a470-4fe5-5424-9182f4bc0500/medium" width="100" style="opacity:0.75;" alt="" />
  </div>
  <p style="font-size:12px;color:#64748b;margin:20px 0 0;">Inner Animal Media · inneranimalmedia.com · Auto-generated deploy notification</p>
</div>`;
}

function parseNotifyRecipients(env) {
  const single = String(env.DEPLOY_NOTIFY_EMAIL || env.RESEND_NOTIFY_EMAIL || '').trim();
  if (single) return [single];
  const raw = String(env.DEPLOY_NOTIFY_EMAILS || '').trim();
  if (!raw) return [];
  return raw
    .split(/[,\n]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function handleNotifyDeployComplete(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  if (!verifyBridgeKey(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const meetUrl =
    (typeof env?.MEET_URL === 'string' && env.MEET_URL.trim()) ? env.MEET_URL.trim() : DEFAULT_MEET_URL;
  const html = deployEmailHtml(meetUrl);
  const text = `Production is live. Join: ${meetUrl}`;
  const subject = 'Agent Sam Deployed — join live session';
  const recipients = parseNotifyRecipients(env);
  const deploymentIdHint =
    body.deployment_id != null
      ? String(body.deployment_id).trim()
      : body.worker_version_id != null
        ? String(body.worker_version_id).trim()
        : '';

  const work = (async () => {
    if (recipients.length === 0) return { sent: 0, failed: 0 };
    const deploymentId = await resolvePhoneLoopDeploymentId(env, deploymentIdHint);
    let sent = 0;
    let failed = 0;
    for (const to of recipients) {
      const result = await sendPlatformEmail(env, {
        to,
        subject,
        html,
        text,
        category: 'deploy_notify',
        noAgentSamPrefix: true,
      });
      const resendId =
        result?.externalMessageId || result?.data?.id || result?.id || null;
      const ok = !!(result?.success && resendId);
      await recordPhoneLoopDeploymentNotification(env, {
        deploymentId,
        recipient: to,
        subject,
        message: text,
        status: ok ? 'sent' : 'failed',
        errorMessage: ok ? null : String(result?.error || 'missing_resend_message_id'),
        resendMessageId: resendId,
        notificationType: 'deploy_email',
      });
      if (ok) sent += 1;
      else failed += 1;
    }
    return { sent, failed, deploymentId };
  })();

  if (ctx?.waitUntil) {
    ctx.waitUntil(work.catch((e) => console.warn('[notify-deploy-complete]', e?.message ?? e)));
    return jsonResponse({ ok: true, queued: true, meet_url: meetUrl });
  }
  const out = await work.catch((e) => {
    console.warn('[notify-deploy-complete]', e?.message ?? e);
    return { sent: 0, failed: 1, error: e?.message || String(e) };
  });
  return jsonResponse({ ok: true, meet_url: meetUrl, ...out });
}
