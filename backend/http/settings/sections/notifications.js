/**
 * Settings section: Notifications (read prefs, patch prefs, send test).
 * - GET   /api/settings/notifications
 * - PATCH /api/settings/notifications
 * - POST  /api/settings/notifications/test
 * Deconstructed from src/api/settings-sections.js (Sections peel SEC3, no
 * behavior change).
 */
import { jsonResponse } from '../../agentsam/shared.js';
import {
  applyFlatNotifyUpdates,
  notifyBagToFlat,
  readNotificationPrefs,
  resolveNotificationEmail,
  writeNotificationPrefs,
} from '../../../identity/notification-prefs.js';
import { notifyUser } from '../../../identity/notify-user.js';
import { safeQueryAll, envelope } from './shared.js';

// ─── Section: Notifications ──────────────────────────────────────────────────
async function getNotifications(env, authUser) {
  const warnings = [];
  const cache = new Map();
  const db = env.DB;
  const userId = authUser?.id != null ? String(authUser.id).trim() : '';
  const tenantId = authUser?.tenant_id != null ? String(authUser.tenant_id).trim() : '';

  let notifyEmail = '';
  let notifyEmailSource = '';
  let prefsFlat = {};
  try {
    if (!userId) throw new Error('user_id_required');
    const resolved = await resolveNotificationEmail(env, userId);
    notifyEmail = resolved.email;
    notifyEmailSource = resolved.source;
    const bag = await readNotificationPrefs(env, userId);
    prefsFlat = notifyBagToFlat(bag);
  } catch (e) {
    warnings.push({
      code: 'NOTIFICATION_EMAIL_UNRESOLVED',
      message: `No notification email on your account (${e?.message || e}). Set a primary email on your profile before enabling alerts.`,
      severity: 'error',
      suggestedAction: 'Update account email via signed-in identity / profile.',
    });
  }

  const recentErrors = await safeQueryAll(
    db,
    'agentsam_error_log',
    tenantId
      ? `SELECT id, error_type AS severity, source, error_message AS message, created_at
         FROM agentsam_error_log
         WHERE tenant_id = ?
         ORDER BY created_at DESC LIMIT 25`
      : `SELECT id, error_type AS severity, source, error_message AS message, created_at
         FROM agentsam_error_log
         ORDER BY created_at DESC LIMIT 25`,
    tenantId ? [tenantId] : [],
    warnings,
    cache,
  );

  const escalations = await safeQueryAll(
    db,
    'agentsam_escalation',
    `SELECT id, kind, reason, mode, to_route_key, from_model_key, to_model_key,
            status, agent_run_id, spawn_session_id, approval_queue_id,
            error_message, created_at_unix
     FROM agentsam_escalation
     ORDER BY created_at_unix DESC LIMIT 25`,
    [],
    warnings,
    cache,
  );

  const approvals = await safeQueryAll(
    db,
    'agentsam_approval_queue',
    userId
      ? `SELECT id, tool_name AS kind, user_id AS requested_by, status, action_summary, created_at
         FROM agentsam_approval_queue
         WHERE user_id = ?
         ORDER BY created_at DESC LIMIT 25`
      : `SELECT id, tool_name AS kind, user_id AS requested_by, status, action_summary, created_at
         FROM agentsam_approval_queue
         ORDER BY created_at DESC LIMIT 25`,
    userId ? [userId] : [],
    warnings,
    cache,
  );

  const webhookEvents = await safeQueryAll(
    db,
    'agentsam_webhook_events',
    tenantId
      ? `SELECT id, provider AS source, event_type, status, received_at_unix AS created_at
         FROM agentsam_webhook_events
         WHERE tenant_id = ?
         ORDER BY received_at_unix DESC LIMIT 25`
      : `SELECT id, provider AS source, event_type, status, received_at_unix AS created_at
         FROM agentsam_webhook_events
         ORDER BY received_at_unix DESC LIMIT 25`,
    tenantId ? [tenantId] : [],
    warnings,
    cache,
  );

  const integrationEvents = await safeQueryAll(
    db,
    'integration_events',
    tenantId
      ? `SELECT id, provider_key AS slug, event_type, actor AS severity, created_at
         FROM integration_events
         WHERE tenant_id = ?
         ORDER BY created_at DESC LIMIT 25`
      : `SELECT id, provider_key AS slug, event_type, actor AS severity, created_at
         FROM integration_events
         ORDER BY created_at DESC LIMIT 25`,
    tenantId ? [tenantId] : [],
    warnings,
    cache,
  );

  const canTest = Boolean(
    (prefsFlat['notify.channel.email'] === 'true' && notifyEmail && notifyEmail.includes('@')) ||
      prefsFlat['notify.channel.push'] === 'true' ||
      prefsFlat['notify.channel.imessage'] === 'true',
  );

  return envelope('notifications', {
    summary: {
      recent_errors: recentErrors.length,
      open_escalations: escalations.filter((e) =>
        ['proposed', 'accepted', 'running'].includes(String(e.status || '').toLowerCase()),
      ).length,
      pending_approvals: approvals.filter((a) => String(a.status || '').toLowerCase() === 'pending').length,
      recent_webhook_events: webhookEvents.length,
      recent_integration_events: integrationEvents.length,
    },
    rows: [],
    warnings,
    actions: [
      {
        key: 'save_preferences',
        label: 'Save notification preferences',
        enabled: Boolean(userId),
        reasonDisabled: userId ? undefined : 'Sign in required to save preferences.',
      },
      {
        key: 'send_test_notification',
        label: 'Send test notification',
        enabled: canTest,
        reasonDisabled: canTest
          ? undefined
          : 'Enable at least one delivery channel before sending a test notification.',
      },
    ],
    extra: {
      errors: recentErrors,
      escalations,
      approvals,
      webhook_events: webhookEvents,
      integration_events: integrationEvents,
      preferences: prefsFlat,
      notification_email: notifyEmail,
      notification_email_source: notifyEmailSource,
    },
  });
}

async function patchNotificationPreferences(request, env, authUser) {
  const userId = authUser?.id != null ? String(authUser.id).trim() : '';
  if (!userId) return jsonResponse({ error: 'user_id_required' }, 401);
  const body = await request.json().catch(() => ({}));
  const updates = Array.isArray(body?.updates) ? body.updates : null;
  const prefsObj =
    body?.preferences && typeof body.preferences === 'object' ? body.preferences : null;
  if (!updates && !prefsObj) {
    return jsonResponse({ error: 'updates_or_preferences_required' }, 400);
  }
  const current = await readNotificationPrefs(env, userId);
  const next = applyFlatNotifyUpdates(current, updates || prefsObj);
  const saved = await writeNotificationPrefs(env, userId, next);
  let email = '';
  let emailSource = '';
  try {
    const resolved = await resolveNotificationEmail(env, userId);
    email = resolved.email;
    emailSource = resolved.source;
  } catch {
    /* leave empty — caller sees warning on reload */
  }
  return jsonResponse({
    ok: true,
    preferences: notifyBagToFlat(saved),
    notification_email: email,
    notification_email_source: emailSource,
  });
}

async function postNotificationTest(request, env, authUser, ctx) {
  const userId = authUser?.id != null ? String(authUser.id).trim() : '';
  if (!userId) return jsonResponse({ error: 'user_id_required' }, 401);
  const tenantId = authUser?.tenant_id != null ? String(authUser.tenant_id).trim() : '';
  // Await the send (no waitUntil) so the UI gets a real success/failure.
  const result = await notifyUser(
    env,
    {
      userId,
      tenantId,
      subject: 'Notification test',
      body: 'This is a test notification from Inner Animal Media settings. Your enabled delivery channels are wired correctly.',
      category: 'settings_test',
      noAgentSamPrefix: false,
    },
    null,
  );
  if (result?.skipped && result?.data?.reason === 'all_channels_disabled') {
    return jsonResponse({ error: 'notification_channels_disabled' }, 400);
  }
  if (result?.success === false) {
    return jsonResponse(
      {
        error: result?.error || 'send_failed',
        detail: 'One or more enabled notification channels failed. Check the channel configuration for this deployment.',
      },
      502,
    );
  }
  return jsonResponse({
    ok: true,
    sent: true,
    channels: result?.data?.channels || {},
  });
}


export { getNotifications, patchNotificationPreferences, postNotificationTest };
