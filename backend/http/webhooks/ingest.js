/**
 * Canonical webhook ingest: D1 audit row + optional registry workflow dispatch.
 */
import {
  insertAgentsamWebhookEvent,
  markAgentsamWebhookEventFailed,
  markAgentsamWebhookEventIgnored,
  markAgentsamWebhookEventProcessed,
  resolveWebhookInsertScope,
} from '../../services/webhooks/ledger.js';
import { dispatchWebhookRegistryWorkflow } from '../workflows/webhook-dispatch.js';

/** Registry soft-skips — not failures (nothing to dispatch). */
const DISPATCH_SOFT_SKIP = new Set([
  'no_workflow_key',
  'event_not_allowed',
  'provider_not_dispatch_enabled',
  'missing_ids',
]);

/**
 * @param {any} env
 * @param {any} [ctx]
 * @param {Parameters<typeof insertAgentsamWebhookEvent>[1]} opts
 * @param {{ skipDispatch?: boolean, deferDispatch?: boolean }} [extra]
 *   deferDispatch: await durable insert only; mark+workflow via ctx.waitUntil (fast 2xx).
 *   Use only when the provider needs a quick ack (e.g. Cursor) — not for parity with GitHub/OpenAI.
 */
export async function ingestWebhookEventAndDispatch(env, ctx, opts, extra = {}) {
  const scope = await resolveWebhookInsertScope(env, opts);
  const merged = {
    ...opts,
    tenantId: scope.tenantId ?? opts.tenantId ?? null,
    workspaceId: scope.workspaceId ?? opts.workspaceId ?? null,
  };
  const ins = await insertAgentsamWebhookEvent(env, merged);
  if (!ins?.ok || !ins?.id) {
    return { ok: false, reason: ins?.reason ?? 'insert_failed', id: ins?.id ?? null };
  }
  if (ins.duplicate) {
    return { ok: true, id: ins.id, endpointId: ins.endpointId ?? null, duplicate: true };
  }

  const finish = async () => {
    try {
      let dispatchResult = { ok: true, skipped: true };
      if (!extra.skipDispatch) {
        // Already inside a top-level waitUntil (deferDispatch). Pass ctx=null and
        // await: nesting another waitUntil from inside a deferred callback is not
        // guaranteed to extend the Worker isolate lifetime the way a top-level
        // waitUntil does — that was the "silently twice" failure mode (swallowed
        // errors + deferred work that may never have run). Do not "fix" this
        // back to passing ctx.
        dispatchResult = await dispatchWebhookRegistryWorkflow(
          env,
          extra.deferDispatch ? null : ctx,
          {
            eventId: ins.id,
            provider: merged.provider,
            eventType: merged.eventType,
            payload:
              merged.payload ??
              (merged.payloadJson
                ? (() => {
                    try {
                      return JSON.parse(String(merged.payloadJson));
                    } catch {
                      return { _raw: String(merged.payloadJson).slice(0, 4000) };
                    }
                  })()
                : null),
            tenantId: merged.tenantId ?? null,
            workspaceId: merged.workspaceId ?? null,
          },
        );
      }

      const reason = String(dispatchResult?.reason || '');
      const softSkip = DISPATCH_SOFT_SKIP.has(reason);

      // Cursor registry is expected to have wf_on_cursor + statusChange allowed —
      // no_workflow_key / event_not_allowed here is misconfig, not an intentional no-op.
      const cursorMisconfig =
        String(merged.provider || '').toLowerCase() === 'cursor' &&
        (reason === 'no_workflow_key' || reason === 'event_not_allowed');

      if (cursorMisconfig) {
        await markAgentsamWebhookEventFailed(
          env,
          ins.id,
          `${reason}: Cursor expects agentsam_webhooks.workflow_key=wf_on_cursor and allowed_events including statusChange/status_change`,
        );
        return;
      }

      if (dispatchResult?.ok || dispatchResult?.scheduled || extra.skipDispatch) {
        await markAgentsamWebhookEventProcessed(env, ins.id);
        return;
      }

      if (softSkip) {
        // Known blur for non-Cursor providers: "no workflow" may mean intentional
        // no-op OR forgotten registry row — status=ignored keeps that visible vs processed.
        await markAgentsamWebhookEventIgnored(env, ins.id, reason);
        return;
      }

      // Durable insert already returned 2xx to Cursor — surface failure on the event row.
      await markAgentsamWebhookEventFailed(
        env,
        ins.id,
        reason || 'dispatch_failed',
      );
    } catch (e) {
      await markAgentsamWebhookEventFailed(env, ins.id, e?.message || String(e));
      console.warn('[webhook-ingest] finish', merged.provider, e?.message ?? e);
    }
  };

  if (extra.deferDispatch && typeof ctx?.waitUntil === 'function') {
    ctx.waitUntil(finish());
    return { ok: true, id: ins.id, endpointId: ins.endpointId ?? null, deferred: true };
  }

  await finish();
  return { ok: true, id: ins.id, endpointId: ins.endpointId ?? null };
}
