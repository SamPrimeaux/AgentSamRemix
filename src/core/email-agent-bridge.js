/**
 * Phone-email IDE bridge: inbound reply → Agent Sam turn → dual outbound (email + push).
 *
 * Sender allowlist is D1-only: active superadmins in the platform tenant, matching
 * auth_users.email OR auth_user_emails aliases (iam_alias etc.). No hardcoded email lists.
 */

import {
  isD1WorkspaceId,
  isPlatformAuthUserId,
  isTenantId,
  resolvePlatformOperatorEmailPrimary,
} from './platform-identity-constants.js';
import { resolveCronTenantId, resolveCronWorkspaceId } from '../../backend/jobs/cron-tenant.js';
import { resolveIamSystemActorId } from '../../backend/identity/system-actor.js';
import { parseEmailReplyThread } from './email-reply-thread.js';
import { sendPlatformEmail } from '../lib/email.js';
import { scheduleChatSessionTitleInsert } from '../../backend/agentsam/sessions/index.js';

/** @param {any} env */
function resolvePhoneLoopInbox(env) {
  const fromEnv = String(env?.PHONE_LOOP_INBOX || env?.PHONE_LOOP_REPLY_TO || '').trim().toLowerCase();
  if (fromEnv.includes('@')) return fromEnv;
  return resolvePlatformOperatorEmailPrimary(env);
}

/**
 * @param {any} env
 * @param {{ userId?: string | null, workspaceId?: string | null, tenantId?: string | null }} [override]
 */
export async function resolvePhoneLoopIdentity(env, override = {}) {
  const uid = override.userId != null ? String(override.userId).trim() : '';
  const wid = override.workspaceId != null ? String(override.workspaceId).trim() : '';
  const tid = override.tenantId != null ? String(override.tenantId).trim() : '';

  let userId = isPlatformAuthUserId(uid) ? uid : null;
  if (!userId) {
    userId = await resolveIamSystemActorId(env);
  }
  if (!userId) {
    throw new Error('platform_d1_auth_user_id_required');
  }

  let workspaceId = isD1WorkspaceId(wid) ? wid : null;
  if (!workspaceId) {
    workspaceId = await resolveCronWorkspaceId(env);
  }
  if (!workspaceId) {
    throw new Error('platform_d1_workspace_id_required');
  }

  let tenantId = isTenantId(tid) ? tid : null;
  if (!tenantId) {
    tenantId = await resolveCronTenantId(env);
  }
  if (!tenantId) {
    throw new Error('platform_tenant_id_required');
  }

  return {
    userId,
    workspaceId,
    tenantId,
    operatorEmail: resolvePlatformOperatorEmailPrimary(env),
    inbox: resolvePhoneLoopInbox(env),
  };
}

/**
 * @param {string} email
 */
export function normalizePhoneLoopSenderEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .replace(/^.*<([^>]+)>.*$/, '$1')
    .trim();
}

/**
 * D1 allowlist: primary auth_users.email OR auth_user_emails alias → active superadmin.
 * Must join aliases via EXISTS — auth_users.email alone misses iam_alias rows.
 *
 * @param {any} env
 * @param {string} email
 * @returns {Promise<boolean>}
 */
export async function isPhoneLoopAllowlistedSender(env, email) {
  const normalized = normalizePhoneLoopSenderEmail(email);
  if (!normalized || !normalized.includes('@') || !env?.DB) return false;

  const { tenantId } = await resolvePhoneLoopIdentity(env);

  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS ok
         FROM auth_users au
        WHERE au.tenant_id = ?
          AND COALESCE(au.is_superadmin, 0) = 1
          AND lower(trim(COALESCE(au.status, ''))) = 'active'
          AND (
            lower(trim(au.email)) = ?
            OR EXISTS (
              SELECT 1
                FROM auth_user_emails aue
               WHERE aue.auth_user_id = au.id
                 AND lower(trim(aue.email)) = ?
                 AND COALESCE(aue.is_login_enabled, 1) = 1
            )
          )
        LIMIT 1`,
    )
      .bind(tenantId, normalized, normalized)
      .first();
    return !!row?.ok;
  } catch (e) {
    console.warn('[isPhoneLoopAllowlistedSender]', e?.message ?? e);
    return false;
  }
}

/**
 * Resolve a deployments.id to attach phone-loop email receipts to the deploy trail.
 * @param {any} env
 * @param {string} [preferredId]
 */
export async function resolvePhoneLoopDeploymentId(env, preferredId) {
  const preferred = preferredId != null ? String(preferredId).trim() : '';
  if (preferred) return preferred;
  if (!env?.DB) return `phone_loop_${Date.now()}`;
  const row = await env.DB.prepare(
    `SELECT id FROM deployments
     WHERE lower(COALESCE(status, '')) IN ('success', 'succeeded', 'ok', 'complete', 'completed')
     ORDER BY datetime(COALESCE(created_at, updated_at)) DESC
     LIMIT 1`,
  )
    .first()
    .catch(() => null);
  if (row?.id) return String(row.id);
  return `phone_loop_${Date.now()}`;
}

/**
 * Append-only email receipt on deployment_notifications (deploy trail + phone IDE loop).
 * status='sent' requires a real Resend message id — never optimistic.
 * @param {any} env
 * @param {{
 *   deploymentId: string,
 *   recipient: string,
 *   subject: string,
 *   message?: string|null,
 *   status: 'pending'|'sent'|'failed'|'skipped',
 *   errorMessage?: string|null,
 *   notificationType?: string,
 *   resendMessageId?: string|null,
 * }} row
 */
export async function recordPhoneLoopDeploymentNotification(env, row) {
  if (!env?.DB) return { ok: false, reason: 'no_db' };
  const id = `dn_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const deploymentId = String(row.deploymentId || '').trim();
  const recipient = String(row.recipient || '').trim();
  const subject = String(row.subject || '').trim().slice(0, 400);
  const message = row.message != null ? String(row.message).slice(0, 8000) : null;
  const resendMessageId =
    row.resendMessageId != null && String(row.resendMessageId).trim()
      ? String(row.resendMessageId).trim()
      : null;
  let status = ['pending', 'sent', 'failed', 'skipped'].includes(String(row.status))
    ? String(row.status)
    : 'pending';
  // Honesty gate: never claim sent without a provider message id.
  if (status === 'sent' && !resendMessageId) {
    status = 'failed';
  }
  const notificationType = String(row.notificationType || 'phone_loop_email').slice(0, 64);
  let errorMessage =
    row.errorMessage != null ? String(row.errorMessage).slice(0, 2000) : null;
  if (status === 'failed' && !errorMessage && !resendMessageId) {
    errorMessage = 'missing_resend_message_id';
  }
  if (!deploymentId || !recipient || !subject) {
    return { ok: false, reason: 'missing_fields' };
  }
  try {
    await env.DB.prepare(
      `INSERT INTO deployment_notifications (
         id, deployment_id, notification_type, recipient, subject, message,
         status, sent_at, error_message, resend_message_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'sent' THEN datetime('now') ELSE NULL END, ?, ?, datetime('now'), datetime('now'))`,
    )
      .bind(
        id,
        deploymentId,
        notificationType,
        recipient,
        subject,
        message,
        status,
        status,
        errorMessage,
        resendMessageId,
      )
      .run();
    return { ok: true, id, deploymentId, status, resendMessageId };
  } catch (e) {
    // Column may not exist until migration 1018 — fall back without resend_message_id.
    const msg = String(e?.message || e);
    if (/resend_message_id/i.test(msg)) {
      try {
        await env.DB.prepare(
          `INSERT INTO deployment_notifications (
             id, deployment_id, notification_type, recipient, subject, message,
             status, sent_at, error_message, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'sent' THEN datetime('now') ELSE NULL END, ?, datetime('now'), datetime('now'))`,
        )
          .bind(
            id,
            deploymentId,
            notificationType,
            recipient,
            subject,
            message,
            status,
            status,
            errorMessage,
          )
          .run();
        return { ok: true, id, deploymentId, status, resendMessageId, legacy: true };
      } catch (e2) {
        console.warn('[recordPhoneLoopDeploymentNotification]', e2?.message ?? e2);
        return { ok: false, reason: e2?.message || String(e2) };
      }
    }
    console.warn('[recordPhoneLoopDeploymentNotification]', msg);
    return { ok: false, reason: msg };
  }
}

/**
 * Dual outbound: email + push in the same waitUntil batch (no sequencing dependency).
 * Also writes deployment_notifications so the email trail is queryable next to deploy rows.
 *
 * Deep-link target is ALWAYS /dashboard/mail (not empty agent chat): open the sent
 * message with next-step chips so iPhone tap lands on actionable Mail.
 *
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   conversationId: string,
 *   inReplyTo?: string|null,
 *   subject: string,
 *   body: string,
 *   pushTitle: string,
 *   pushBody: string,
 *   deploymentId?: string|null,
 *   pushActions?: boolean,
 *   continueInstruction?: string,
 *   statusInstruction?: string,
 *   nextSteps?: { action: string, label: string, instruction: string }[],
 *   userId?: string|null,
 *   workspaceId?: string|null,
 *   tenantId?: string|null,
 * }} opts
 */
export async function sendPhoneLoopCompletion(env, ctx, opts) {
  const conversationId = String(opts.conversationId || '').trim();
  if (!conversationId) {
    return { ok: false, error: 'conversation_id_required' };
  }

  const identity = await resolvePhoneLoopIdentity(env, {
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    tenantId: opts.tenantId,
  });

  const subject = String(opts.subject || '[Agent Sam] update').trim();
  let body = String(opts.body || '').trim();
  const pushTitle = String(opts.pushTitle || subject).trim().slice(0, 80);
  const pushBody = String(opts.pushBody || body.slice(0, 140)).trim().slice(0, 180);
  const inReplyTo = opts.inReplyTo != null ? String(opts.inReplyTo).trim() : '';
  const wantActions = opts.pushActions !== false;

  const continueInstruction =
    (opts.continueInstruction && String(opts.continueInstruction).trim()) ||
    'Continue the work on this Agent Sam thread. Pick up from the last result and proceed with the next logical steps.';
  const statusInstruction =
    (opts.statusInstruction && String(opts.statusInstruction).trim()) ||
    'Give me a short status update on this conversation — what finished, what is blocked, and what you recommend next.';

  const nextSteps =
    Array.isArray(opts.nextSteps) && opts.nextSteps.length
      ? opts.nextSteps.slice(0, 5)
      : [
          { action: 'continue', label: 'Continue', instruction: continueInstruction },
          { action: 'status', label: 'Status', instruction: statusInstruction },
        ];

  const { buildNextStepsEmbeds } = await import('./email-reply-thread.js');
  const stepEmbeds = buildNextStepsEmbeds(nextSteps, conversationId);
  if (stepEmbeds.footerText && !body.includes('## Next steps')) {
    body = `${body}${stepEmbeds.footerText}`;
  }
  const htmlExtra = stepEmbeds.htmlComment || '';

  const run = async () => {
    const deploymentId = await resolvePhoneLoopDeploymentId(env, opts.deploymentId);

    const emailResult = await sendPlatformEmail(env, {
      to: identity.inbox,
      subject,
      text: body,
      html: htmlExtra
        ? `<pre style="white-space:pre-wrap;font-family:system-ui,sans-serif">${escapeHtmlPhone(body)}</pre>\n${htmlExtra}`
        : undefined,
      category: 'phone_loop',
      conversationId,
      inReplyTo: inReplyTo || undefined,
      noAgentSamPrefix: subject.startsWith('[Agent Sam]'),
      userId: identity.userId,
      tenantId: identity.tenantId,
    });

    const resendId =
      emailResult?.externalMessageId ||
      emailResult?.data?.id ||
      emailResult?.id ||
      null;
    const emailLogId =
      emailResult?.emailLogId != null ? String(emailResult.emailLogId).trim() : '';
    const emailOk = !!(emailResult && emailResult.success === true && resendId);

    // Mail is the phone IDE surface — never deep-link into a blank agent chat.
    const deepLink = emailLogId
      ? `/dashboard/mail?email=${encodeURIComponent(emailLogId)}&folder=sent&c=${encodeURIComponent(conversationId)}`
      : `/dashboard/mail?folder=sent&c=${encodeURIComponent(conversationId)}`;

    const notifyRow = await recordPhoneLoopDeploymentNotification(env, {
      deploymentId,
      recipient: identity.inbox,
      subject,
      message: [
        body.slice(0, 4000),
        '',
        `conversation_id=${conversationId}`,
        `deep_link=${deepLink}`,
        emailLogId ? `email_log_id=${emailLogId}` : '',
        emailOk ? 'resend_ok=1' : 'resend_ok=0',
        resendId ? `resend_id=${resendId}` : '',
        emailResult?.error ? `error=${emailResult.error}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      status: emailOk ? 'sent' : 'failed',
      errorMessage: emailOk
        ? null
        : String(emailResult?.error || (!resendId ? 'missing_resend_message_id' : 'email_send_failed')),
      resendMessageId: resendId,
      notificationType: 'phone_loop_email',
    });

    let pushResult = { ok: false, reason: 'not_attempted' };
    let notifId = null;
    try {
      const { broadcastWebPushToActiveSubscriptions, insertPushNotification } = await import(
        '../../backend/identity/web-push-runtime.js'
      );
      const { buildPhoneLoopPushActions } = await import('./push-action-token.js');
      const actionPack = wantActions
        ? await buildPhoneLoopPushActions(env, conversationId, {
            continueInstruction,
            statusInstruction,
          })
        : { actions: [], actionTokens: {} };

      notifId = await insertPushNotification(env, {
        recipientId: identity.userId,
        channel: 'push',
        subject: pushTitle,
        message: pushBody,
        entityType: 'email',
        entityId: emailLogId || conversationId,
        status: 'sent',
        data: {
          url: deepLink,
          tag: conversationId,
          type: 'phone_loop',
          conversationId,
          emailLogId: emailLogId || null,
          actions: actionPack.actions,
        },
      }).catch(() => null);

      const pushUrl = notifId
        ? `${deepLink}${deepLink.includes('?') ? '&' : '?'}notif=${encodeURIComponent(notifId)}`
        : deepLink;

      pushResult = await broadcastWebPushToActiveSubscriptions(env, {
        title: pushTitle,
        body: pushBody,
        url: pushUrl,
        tag: conversationId,
        notificationId: notifId || undefined,
        entityType: 'email',
        entityId: emailLogId || conversationId,
        actions: actionPack.actions,
        actionTokens: actionPack.actionTokens,
      });
    } catch (e) {
      pushResult = { ok: false, reason: e?.message || String(e) };
      console.warn('[sendPhoneLoopCompletion] push', e?.message ?? e);
    }

    return {
      ok: true,
      email: emailResult,
      push: pushResult,
      conversationId,
      deepLink,
      emailLogId: emailLogId || null,
      deploymentId,
      notification: notifyRow,
      nextSteps: stepEmbeds.steps,
    };
  };

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(run());
    return {
      ok: true,
      async: true,
      conversationId,
      deepLink: `/dashboard/mail?folder=sent&c=${encodeURIComponent(conversationId)}`,
    };
  }
  return run();
}

function escapeHtmlPhone(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Ensure chat session exists for conversationId (no orphan mint when id already provided).
 * @param {any} env
 * @param {any} ctx
 * @param {string} conversationId
 * @param {string} [seedMessage]
 */
export async function ensurePhoneLoopChatSession(env, ctx, conversationId, seedMessage) {
  const id = String(conversationId || '').trim();
  if (!id || !env?.DB) return { ok: false, error: 'missing' };

  const identity = await resolvePhoneLoopIdentity(env);

  scheduleChatSessionTitleInsert(env, ctx || { waitUntil() {} }, {
    conversationId: id,
    tenantId: identity.tenantId,
    userId: identity.userId,
    workspaceId: identity.workspaceId,
    message: String(seedMessage || 'Phone email thread').slice(0, 500),
    modelKey: null,
  });

  return { ok: true, conversationId: id };
}

/**
 * Mint a new conversation id when inbound has no [ref:].
 */
export function mintPhoneLoopConversationId() {
  return crypto.randomUUID();
}

/**
 * Collect assistant text from an SSE agent response body.
 * @param {Response} response
 */
async function collectSseAssistantText(response) {
  if (!response?.body) {
    const t = await response.text().catch(() => '');
    return t.slice(0, 12000);
  }
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop() || '';
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const evt = JSON.parse(payload);
        const typ = String(evt.type || evt.event || '');
        if (typ === 'token' || typ === 'text_delta' || typ === 'content_delta') {
          text += String(evt.text ?? evt.delta ?? evt.content ?? '');
        } else if (typ === 'message' || typ === 'assistant_message') {
          text += String(evt.content ?? evt.text ?? '');
        } else if (evt.choices?.[0]?.delta?.content) {
          text += String(evt.choices[0].delta.content);
        }
      } catch {
        /* ignore non-json */
      }
    }
  }
  return text.trim().slice(0, 12000);
}

/**
 * Run one Agent Sam turn from an inbound email reply.
 *
 * @param {any} env
 * @param {any} ctx
 * @param {{
 *   conversationId?: string|null,
 *   instruction: string,
 *   fromAddress: string,
 *   inReplyTo?: string|null,
 *   subject?: string|null,
 * }} payload
 */
export async function runAgentTurnFromEmail(env, ctx, payload) {
  const instruction = String(payload.instruction || '').trim();
  if (!instruction) {
    return { ok: false, error: 'empty_instruction' };
  }
  if (!(await isPhoneLoopAllowlistedSender(env, payload.fromAddress))) {
    return { ok: false, error: 'sender_not_allowlisted' };
  }

  let conversationId = String(payload.conversationId || '').trim();
  const minted = !conversationId;
  if (!conversationId) conversationId = mintPhoneLoopConversationId();

  await ensurePhoneLoopChatSession(env, ctx, conversationId, instruction);

  const inReplyTo = payload.inReplyTo != null ? String(payload.inReplyTo).trim() : '';
  const subjectIn = payload.subject != null ? String(payload.subject) : '';

  const work = async () => {
    let identity = null;
    try {
      identity = await resolvePhoneLoopIdentity(env);
      const { executeAgentChatSpine } = await import('../api/agent-chat-spine.js');
      const body = {
        message: instruction,
        conversationId,
        conversation_id: conversationId,
        sessionId: conversationId,
        mode: 'agent',
        trigger: 'email_reply',
        source: 'email_phone',
        stream: true,
      };
      const request = new Request('https://inneranimalmedia.com/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'X-AgentSam-Trigger': 'email_reply',
        },
        body: JSON.stringify(body),
      });

      const authUser = {
        id: identity.userId,
        email: identity.operatorEmail,
        tenant_id: identity.tenantId,
        role: 'superadmin',
      };

      const response = await executeAgentChatSpine(env, request, ctx || { waitUntil() {} }, {
        body,
        message: instruction,
        requestedMode: 'agent',
        tenantId: identity.tenantId,
        userId: identity.userId,
        workspaceId: identity.workspaceId,
        sessionId: conversationId,
        authUser,
      });

      let assistantText = '';
      if (response && typeof response === 'object' && response.body) {
        assistantText = await collectSseAssistantText(response);
      }

      const outcomeBody =
        assistantText ||
        `Received your email instruction and ran an Agent Sam turn.\n\nInstruction:\n${instruction.slice(0, 2000)}`;

      await sendPhoneLoopCompletion(env, null, {
        conversationId,
        inReplyTo: inReplyTo || null,
        subject: subjectIn
          ? `[Agent Sam] Re: ${subjectIn.replace(/^re:\s*/i, '').slice(0, 80)}`
          : `[Agent Sam] Turn complete`,
        body: `${outcomeBody}\n\n---\nWhat you asked:\n${instruction.slice(0, 1500)}`,
        pushTitle: 'Agent Sam reply ready',
        pushBody: outcomeBody.replace(/\s+/g, ' ').slice(0, 140),
      });

      return { ok: true, conversationId, minted, assistantChars: assistantText.length };
    } catch (e) {
      console.error('[runAgentTurnFromEmail]', e?.message ?? e);
      try {
        const errIdentity = identity || (await resolvePhoneLoopIdentity(env));
        await env.DB?.prepare(
          `INSERT INTO agentsam_error_log (
             id, workspace_id, tenant_id, error_code, error_message, source, context_json, resolved, created_at
           ) VALUES (?, ?, ?, 'email_reply_loop', ?, 'email_agent_bridge', ?, 0, unixepoch())`,
        )
          .bind(
            `aerr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
            errIdentity.workspaceId,
            errIdentity.tenantId,
            String(e?.message || e).slice(0, 500),
            JSON.stringify({ conversationId, from: payload.fromAddress }).slice(0, 2000),
          )
          .run();
      } catch {
        /* ignore */
      }
      await sendPhoneLoopCompletion(env, null, {
        conversationId,
        inReplyTo: inReplyTo || null,
        subject: '[Agent Sam] Turn failed',
        body: `Agent turn failed: ${e?.message || e}\n\nYour instruction was:\n${instruction.slice(0, 1500)}`,
        pushTitle: 'Agent Sam turn failed',
        pushBody: String(e?.message || e).slice(0, 140),
      }).catch(() => null);
      return { ok: false, error: e?.message || String(e), conversationId };
    }
  };

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(work());
    return { ok: true, accepted: true, conversationId, minted };
  }
  return work();
}

/**
 * Convenience: parse inbound payload fields then run the turn.
 */
export async function handleParsedEmailReply(env, ctx, raw) {
  const parsed = parseEmailReplyThread({
    text: raw.text,
    html: raw.html,
    subject: raw.subject,
    inReplyTo: raw.inReplyTo,
  });
  return runAgentTurnFromEmail(env, ctx, {
    conversationId: parsed.conversationId,
    instruction: parsed.instruction,
    fromAddress: raw.fromAddress,
    inReplyTo: parsed.inReplyTo || raw.inReplyTo,
    subject: raw.subject,
  });
}

/**
 * Push notification action button → Agent Sam turn (same spine as email reply).
 * Instruction must come from a verified sealed token (not free-form client body).
 *
 * @param {any} env
 * @param {any} ctx
 * @param {{ conversationId: string, instruction: string, action?: string }} payload
 */
export async function runAgentTurnFromPushAction(env, ctx, payload) {
  const instruction = String(payload.instruction || '').trim();
  const conversationId = String(payload.conversationId || '').trim();
  if (!instruction || !conversationId) {
    return { ok: false, error: 'conversation_and_instruction_required' };
  }

  return runAgentTurnFromEmail(env, ctx, {
    conversationId,
    instruction,
    fromAddress: (await resolvePhoneLoopIdentity(env)).operatorEmail,
    subject: `[push:${String(payload.action || 'action').slice(0, 24)}]`,
  });
}

export { parseEmailReplyThread };
