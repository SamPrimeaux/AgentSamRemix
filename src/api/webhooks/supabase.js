/**
 * Supabase database webhooks — shared-secret verification + durable audit + routing hooks (D1).
 */
import { jsonResponse } from '../../core/responses.js';
import {
  overviewDirtySectionsForWebhook,
  setOverviewBundleDirty,
} from '../../../packages/shared/overview/dirty-flags.js';
import { resolveWebhookTenantId } from '../../../backend/services/webhooks/ledger.js';
import { ingestWebhookEventAndDispatch } from '../../../backend/services/webhooks/ingest.js';

/** @param {string} a @param {string} b */
function timingSafeEqualUtf8(a, b) {
  const enc = new TextEncoder();
  const ea = enc.encode(a);
  const eb = enc.encode(b);
  if (ea.length !== eb.length) return false;
  let d = 0;
  for (let i = 0; i < ea.length; i += 1) d |= ea[i] ^ eb[i];
  return d === 0;
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function handleSupabaseWebhook(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const recv = String(request.headers.get('x-supabase-webhook-secret') ?? '');
  const expected = String(env.SUPABASE_DB_WEBHOOK_SECRET ?? '');
  if (!expected || !timingSafeEqualUtf8(recv, expected)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const raw = await request.text();
  /** @type {Record<string, unknown>} */
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }

  const routedType =
    (typeof body?.event_type === 'string' && body.event_type) ||
    (typeof body?.type === 'string' && body.type) ||
    '';

  if (routedType === 'workflow_eval_result') {
    await ingestWebhookEventAndDispatch(env, ctx, {
      tenantId:
        typeof body?.tenant_id === 'string' && body.tenant_id.trim()
          ? body.tenant_id.trim()
          : null,
      workspaceId:
        typeof body?.workspace_id === 'string' && body.workspace_id.trim()
          ? body.workspace_id.trim()
          : null,
      provider: 'supabase',
      eventType: routedType,
      payload: body,
      endpointPath: '/api/webhooks/supabase',
      signatureValid: true,
    });
    return new Response(JSON.stringify({ ok: true, routed: 'workflow_eval_result' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const record = body.record && typeof body.record === 'object' ? body.record : body;
  const webhookTenant =
    typeof record?.tenant_id === 'string' && record.tenant_id.trim()
      ? record.tenant_id.trim()
      : null;
  const webhookWorkspace =
    typeof record?.workspace_id === 'string' && record.workspace_id.trim()
      ? record.workspace_id.trim()
      : null;

  const dirtySections = overviewDirtySectionsForWebhook(body.table, body.type);
  if (dirtySections.length && ctx?.waitUntil) {
    ctx.waitUntil(
      (async () => {
        for (const section of dirtySections) {
          await setOverviewBundleDirty(env, section, webhookTenant);
        }
      })(),
    );
  }

  if (env?.DB && ctx?.waitUntil) {
    ctx.waitUntil(
      (async () => {
        const eventType = `${body.type ?? ''}:${body.table ?? ''}`;
        await ingestWebhookEventAndDispatch(env, ctx, {
          tenantId: webhookTenant,
          workspaceId: webhookWorkspace,
          provider: 'supabase',
          eventType,
          payload: body,
          endpointPath: '/api/webhooks/supabase',
          signatureValid: true,
        });

        try {
          await env.DB.prepare(
            `UPDATE webhook_endpoints
             SET total_received = total_received + 1, last_received_at = datetime('now')
             WHERE id = 'whe_supabase_main'`,
          ).run();
        } catch (_) {
          /* legacy counter; registry is agentsam_webhooks */
        }

        switch (body.table) {
          case 'agentsam_routing_decisions': {
            const r = body.record;
            if (!r?.task_type || !r?.selected_model) break;
            try {
              const { applyRewardEvent, resolveTenantIdForReward } = await import(
                '../../core/reward-events.js'
              );
              const { resolveCronWorkspaceId } = await import('../../../backend/jobs/cron-tenant.js');
              let workspaceId =
                r.workspace_id != null && String(r.workspace_id).trim()
                  ? String(r.workspace_id).trim()
                  : null;
              if (!workspaceId) {
                workspaceId = (await resolveCronWorkspaceId(env)) || null;
                if (!workspaceId) break;
              }
              const tenantId = await resolveTenantIdForReward(env, {
                tenantId: r.tenant_id,
                workspaceId,
              });
              if (!tenantId) break;
              await applyRewardEvent(env, {
                tenant_id: tenantId,
                workspace_id: workspaceId,
                task_type: String(r.task_type).trim(),
                signal_type: r.success ? 'auto_success' : 'auto_error',
                signal_value: 1,
                model_key: String(r.selected_model).trim(),
                routing_arm_id: r.routing_arm_id ?? null,
                apply_cost: false,
                apply_latency: false,
                apply_execution: true,
                dedup_key: `supabase_rd:${r.id || `${r.task_type}:${r.selected_model}:${r.created_at || ''}`}`,
                reason: 'webhook_agentsam_routing_decisions',
              });
            } catch (e) {
              console.warn('[webhooks/supabase] routing_decisions reward', e?.message ?? e);
            }
            break;
          }
          case 'build_deploy_events': {
            const r = body.record;
            if (body.type !== 'INSERT') break;
            const hooks = await env.DB.prepare(
              `SELECT id, user_id FROM agentsam_hook
               WHERE trigger = 'post_deploy' AND is_active = 1`,
            ).all();
            for (const hook of hooks.results ?? []) {
              await env.DB.prepare(
                `INSERT INTO agentsam_hook_execution
                   (id, hook_id, user_id, status, source, event_type, payload_json, ran_at)
                 VALUES (
                   'hexec_' || lower(hex(randomblob(6))),
                   ?, ?, 'success', 'supabase', 'post_deploy', ?, datetime('now')
                 )`,
              )
                .bind(hook.id, hook.user_id, JSON.stringify(r))
                .run();
            }
            break;
          }
          default:
            break;
        }
      })(),
    );
  }

  return jsonResponse({ ok: true });
}
