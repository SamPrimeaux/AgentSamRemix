/**
 * After agentsam_webhook_events insert — trigger registry workflow_key when configured.
 */
import { executeWorkflow, resolveWorkflowRow } from '../index.js';

const DISPATCH_PROVIDERS = new Set([
  'github',
  'cloudflare',
  'cursor',
  'supabase',
  'openai',
  'anthropic',
  'resend',
  'internal',
  'stripe',
  'stream',
  'cloudconvert',
]);

/** Queue / legacy provider labels → agentsam_webhooks.provider */
const PROVIDER_ALIASES = {
  my_queue: 'cloudflare',
  cf_queue: 'cloudflare',
  cloudflare_queue: 'cloudflare',
};

/**
 * @param {string} provider
 */
export function resolveWebhookRegistryProvider(provider) {
  const p = String(provider || '').trim().toLowerCase();
  return PROVIDER_ALIASES[p] ?? p;
}

/**
 * Cursor sends camelCase (`statusChange`); registry stores snake_case (`status_change`).
 * @param {string} eventType
 */
export function normalizeWebhookEventType(eventType) {
  return String(eventType || '')
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * @param {any} env
 * @param {any} [ctx]
 * @param {{
 *   eventId: string,
 *   provider: string,
 *   eventType: string,
 *   payload?: unknown,
 *   tenantId?: string | null,
 *   workspaceId?: string | null,
 * }} opts
 */
export async function dispatchWebhookRegistryWorkflow(env, ctx, opts) {
  if (!env?.DB) return { ok: false, reason: 'no_db' };
  const providerRaw = String(opts.provider || '').trim().toLowerCase();
  const lookupProvider = resolveWebhookRegistryProvider(providerRaw);
  const eventType = String(opts.eventType || '').trim();
  const normalizedEventType = normalizeWebhookEventType(eventType);
  const eventId = String(opts.eventId || '').trim();
  if (!lookupProvider || !eventId) return { ok: false, reason: 'missing_ids' };

  if (!DISPATCH_PROVIDERS.has(lookupProvider)) {
    return { ok: false, reason: 'provider_not_dispatch_enabled' };
  }

  let workflowKey = null;
  let endpointRow = null;
  try {
    const selectAllowed = ', allowed_events';

    if (eventId) {
      const ev = await env.DB.prepare(
        `SELECT endpoint_id FROM agentsam_webhook_events WHERE id = ? LIMIT 1`,
      )
        .bind(eventId)
        .first();
      const endpointId =
        ev?.endpoint_id != null ? String(ev.endpoint_id).trim() : '';
      if (endpointId) {
        endpointRow = await env.DB.prepare(
          `SELECT id, workflow_key, tenant_id, workspace_id${selectAllowed}
           FROM agentsam_webhooks
           WHERE id = ? AND is_active = 1 LIMIT 1`,
        )
          .bind(endpointId)
          .first();
      }
    }

    if (!endpointRow) {
      endpointRow = await env.DB.prepare(
        `SELECT id, workflow_key, tenant_id, workspace_id${selectAllowed}
         FROM agentsam_webhooks
         WHERE provider = ? AND is_active = 1
           AND workflow_key IS NOT NULL AND TRIM(workflow_key) != ''
         ORDER BY rowid ASC LIMIT 1`,
      )
        .bind(lookupProvider)
        .first();
    }
    workflowKey =
      endpointRow?.workflow_key != null ? String(endpointRow.workflow_key).trim() : null;
  } catch (e) {
    console.warn('[webhook-workflow] registry lookup', e?.message ?? e);
    return { ok: false, reason: 'registry_lookup_failed' };
  }

  if (!workflowKey) return { ok: false, reason: 'no_workflow_key' };

  if (endpointRow?.allowed_events != null && String(endpointRow.allowed_events).trim() !== '') {
    let allowed = [];
    try {
      const parsed = JSON.parse(String(endpointRow.allowed_events));
      allowed = Array.isArray(parsed) ? parsed : [];
    } catch {
      allowed = [];
    }
    if (allowed.length > 0) {
      const allowedNorm = allowed.map((e) => normalizeWebhookEventType(String(e)));
      if (!allowedNorm.includes(normalizedEventType)) {
        return { ok: false, reason: 'event_not_allowed', event_type: normalizedEventType };
      }
    }
  }

  const tenantId =
    opts.tenantId != null && String(opts.tenantId).trim() !== ''
      ? String(opts.tenantId).trim()
      : endpointRow?.tenant_id != null && String(endpointRow.tenant_id).trim() !== ''
        ? String(endpointRow.tenant_id).trim()
        : null;
  const workspaceId =
    opts.workspaceId != null && String(opts.workspaceId).trim() !== ''
      ? String(opts.workspaceId).trim()
      : endpointRow?.workspace_id != null && String(endpointRow.workspace_id).trim() !== ''
        ? String(endpointRow.workspace_id).trim()
        : null;

  const wf = await resolveWorkflowRow(env.DB, workflowKey, tenantId, workspaceId);
  if (!wf?.workflow_key) {
    return { ok: false, reason: 'workflow_not_found', workflow_key: workflowKey };
  }

  const run = async () => {
    try {
      const out = await executeWorkflow(env, {
        workflowKey,
        input: {
          webhook_event_id: eventId,
          provider: lookupProvider,
          provider_raw: providerRaw,
          event_type: normalizedEventType,
          event_type_raw: eventType,
          payload: opts.payload ?? null,
        },
        tenantId,
        workspaceId,
        userId: null,
        triggerType: 'webhook',
      });
      const workflowRunId =
        out?.workflow_run_id ?? out?.runId ?? out?.run_id ?? out?.id ?? null;
      if (workflowRunId) {
        await env.DB.prepare(
          `UPDATE agentsam_webhook_events SET workflow_run_id = ? WHERE id = ?`,
        )
          .bind(String(workflowRunId), eventId)
          .run()
          .catch(() => {});
        const { patchAgentsamWebhookEventMetadata } = await import('../../services/webhooks/ledger.js');
        await patchAgentsamWebhookEventMetadata(env, eventId, {
          workflow_run_id: String(workflowRunId),
          workflow_triggered: 1,
        });
      }
      return { ok: true, workflow_key: workflowKey, workflow_run_id: workflowRunId };
    } catch (e) {
      console.warn('[webhook-workflow] execute', workflowKey, e?.message ?? e);
      return { ok: false, reason: String(e?.message || e), workflow_key: workflowKey };
    }
  };

  if (ctx?.waitUntil) {
    // Nested waitUntil: callers that already deferred (Cursor) should pass ctx=null so run() is awaited.
    ctx.waitUntil(
      run().catch((e) => {
        console.warn('[webhook-workflow] scheduled execute', workflowKey, e?.message ?? e);
      }),
    );
    return { ok: true, scheduled: true, workflow_key: workflowKey };
  }
  return run();
}
