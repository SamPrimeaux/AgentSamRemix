/**
 * POST /api/internal/exec-identity-alert
 * ExecOS → Worker when runtime user != X-IAM-Exec-Identity (fail-closed signal + D1 + email).
 * Auth: AGENTSAM_BRIDGE_KEY or X-ExecOS-Key (EXECOS_KEY).
 */
import { jsonResponse } from '../core/responses.js'; import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { resolveCronTenantId } from '../../backend/jobs/cron-tenant.js';
import { notifySam } from '../../backend/http/agentsam/routes/git-notifications-runtime.js';

function authorized(request, env) {
  return verifyBridgeKey(request, env);
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} [ctx]
 */
export async function handleExecIdentityAlert(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }
  if (!authorized(request, env)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const expected = String(body.expected_identity || body.expectedIdentity || '').trim();
  const runtime = String(body.runtime_user || body.runtimeUser || '').trim();
  const command = String(body.command || '').slice(0, 500);
  const privilegedTarget = String(body.privileged_target || body.privilegedTarget || '').trim();
  const host = String(body.host || 'iam-tunnel').trim();

  if (!expected || !runtime) {
    return jsonResponse({ error: 'expected_identity_and_runtime_user_required' }, 400);
  }

  let tenantId = await resolveCronTenantId(env);
  if (!tenantId) {
    return jsonResponse({ error: 'platform_tenant_id_required' }, 503);
  }
  const fingerprint = `exec_identity_mismatch:${host}:${expected}:${runtime}`;
  let inserted = false;

  if (env?.DB) {
    const existing = await env.DB.prepare(
      `SELECT id FROM security_findings WHERE fingerprint = ? AND status IN ('open','triaged','false_positive','fixed') LIMIT 1`,
    )
      .bind(fingerprint)
      .first()
      .catch(() => null);

    if (!existing?.id) {
      const id = `sf_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      await env.DB.prepare(
        `INSERT INTO security_findings
           (id, tenant_id, source_type, source_ref, finding_type, severity, fingerprint,
            snippet_redacted, status, created_by, title, description, user_id, metadata_json)
         VALUES (?, ?, 'execos_runtime', ?, 'exec_identity_mismatch', 'critical', ?, ?, 'open', ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          tenantId,
          privilegedTarget || host,
          fingerprint,
          `expected=${expected} runtime=${runtime}`,
          'execos_identity_guard',
          'exec_identity_mismatch',
          `AgentSam exec identity mismatch on ${host}: header claimed ${expected} but process ran as ${runtime}`,
          'system',
          JSON.stringify({
            expected_identity: expected,
            runtime_user: runtime,
            privileged_target: privilegedTarget || null,
            command_preview: command.slice(0, 120),
            host,
          }),
        )
        .run()
        .catch((e) => console.warn('[exec-identity-alert] D1 insert failed', e?.message ?? e));
      inserted = true;
    }
  }

  const subject = `[CRITICAL] Exec identity mismatch on ${host}`;
  const text = [
    `Expected identity: ${expected}`,
    `Runtime user: ${runtime}`,
    `Privileged target: ${privilegedTarget || '(none)'}`,
    `Command preview: ${command.slice(0, 200) || '(none)'}`,
    '',
    'Exec was blocked (fail-closed). Investigate before clearing the finding.',
  ].join('\n');

  const notify = notifySam(
    env,
    { subject, body: text, category: 'security', to: env.RESEND_TO || env.DEPLOY_NOTIFY_EMAIL },
    ctx,
  ).catch((e) => console.warn('[exec-identity-alert] notify failed', e?.message ?? e));

  if (ctx?.waitUntil) ctx.waitUntil(notify);
  else await notify;

  return jsonResponse({
    ok: true,
    alerted: true,
    finding_inserted: inserted,
    fingerprint,
  });
}
