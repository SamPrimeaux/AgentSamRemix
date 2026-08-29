/**
 * POST /api/internal/cron-self-test — run a scheduled cron handler on demand.
 * Auth: AGENTSAM_BRIDGE_KEY (Bearer or X-Internal-Secret).
 */
import { jsonResponse } from '../core/auth.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { handleScheduled } from '../../backend/jobs/scheduled.js';
import {
  runDailyMemoryPipeline,
  runDailyMemoryPipelineAllRecipients,
} from '../../backend/jobs/daily-memory-pipeline.js';
import { listDailyMemoryRecipients } from '../../backend/jobs/daily-plan-support.js';

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function handleCronSelfTest(request, env, ctx) {
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
    /* empty body */
  }

  const cron = typeof body.cron === 'string' ? body.cron.trim() : '';
  const mode = body.mode === 'morning' || body.mode === 'evening' ? body.mode : null;
  const forceEmail = body.force === true || body.forceEmail === true;
  const recipientUserId = typeof body.userId === 'string' ? body.userId.trim() : '';
  const recipientEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const allRecipients = body.allRecipients !== false && !recipientUserId && !recipientEmail;

  if (!cron && !mode) {
    return jsonResponse({
      error: 'cron_or_mode_required',
      detail: 'POST JSON: { "cron": "0 0 * * *" } or { "mode": "evening"|"morning", "force": true, "userId": "au_..." }',
    }, 400);
  }

  const startedAt = Date.now();
  try {
    const runPipeline = async (pipelineMode) => {
      if (allRecipients) {
        return runDailyMemoryPipelineAllRecipients(env, { mode: pipelineMode, ctx, forceEmail });
      }
      let recipient = null;
      if (recipientUserId || recipientEmail) {
        const list = await listDailyMemoryRecipients(env);
        recipient = list.find((r) => (
          (recipientUserId && r.userId === recipientUserId)
          || (recipientEmail && r.email === recipientEmail)
        )) || null;
        if (!recipient && recipientUserId) {
          const row = await env.DB.prepare(
            `SELECT id AS user_id, lower(trim(email)) AS email,
              COALESCE(NULLIF(trim(active_tenant_id), ''), NULLIF(trim(tenant_id), '')) AS tenant_id
             FROM auth_users WHERE id = ? LIMIT 1`,
          ).bind(recipientUserId).first().catch(() => null);
          if (row?.user_id && row?.email) {
            recipient = {
              userId: String(row.user_id),
              email: String(row.email),
              tenantId: row.tenant_id ? String(row.tenant_id) : null,
            };
          }
        }
        if (!recipient) {
          return { ok: false, skipped: true, reason: 'recipient_not_found' };
        }
      }
      return runDailyMemoryPipeline(env, { mode: pipelineMode, ctx, forceEmail, recipient: recipient || undefined });
    };

    if (mode === 'evening' || cron === '0 0 * * *') {
      const out = await runPipeline('evening');
      return jsonResponse({
        ok: true,
        cron: cron || '0 0 * * *',
        job: 'evening_memory_email',
        mode: allRecipients ? 'all_recipients' : 'single',
        forceEmail,
        result: out,
        duration_ms: Date.now() - startedAt,
      });
    }

    if (mode === 'morning' || cron === '30 13 * * *') {
      const out = await runPipeline('morning');
      return jsonResponse({
        ok: true,
        cron: cron || '30 13 * * *',
        job: 'morning_focus_email',
        mode: allRecipients ? 'all_recipients' : 'single',
        forceEmail,
        result: out,
        duration_ms: Date.now() - startedAt,
      });
    }

    await handleScheduled({ cron }, env, ctx);
    return jsonResponse({
      ok: true,
      cron,
      mode: 'handleScheduled',
      duration_ms: Date.now() - startedAt,
    });
  } catch (e) {
    return jsonResponse(
      {
        ok: false,
        cron: cron || mode,
        error: e?.message != null ? String(e.message) : String(e),
        duration_ms: Date.now() - startedAt,
      },
      500,
    );
  }
}

export { sendEveningMemoryEmail, sendMorningFocusEmail } from '../../backend/jobs/daily-memory-pipeline.js';