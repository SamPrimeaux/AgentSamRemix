/**
 * backend/jobs/approval-notify-sweep.js
 * Part 3 of plans/active/MULTITASK-A1-LANE-FANOUT-AND-APPROVAL-NOTIFY-2026-07.md
 *
 * Wraps runApprovalNotifySweep for the every-5-minute cron slot.
 * Own trigger in wrangler.production.toml — not shared with the every-20-minute
 * meshy / WAE / Veo slot.
 *
 * Own function, own catch, own log prefix — intentionally not folded into
 * an existing job body so a failure here is unambiguous in logs.
 */
import { runApprovalNotifySweep } from './approval-notify.js';

/**
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function runApprovalNotifyCron(env, ctx) {
  const out = await runApprovalNotifySweep(env, ctx);
  if (out?.errors?.length) {
    console.warn('[cron] approval_notify_sweep partial_errors', JSON.stringify(out.errors).slice(0, 500));
  }
  let imessage = { enqueued: 0, skipped: 0, applied: 0 };
  try {
    const { syncPendingApprovalsToImessage, applyImessageDecisions } = await import(
      '../integrations/imessage-relay.js'
    );
    const synced = await syncPendingApprovalsToImessage(env);
    const applied = await applyImessageDecisions(env, ctx);
    imessage = { ...synced, ...applied };
  } catch (e) {
    console.warn('[cron] imessage_relay', e?.message ?? e);
  }
  return {
    rowsRead: out?.checked ?? 0,
    rowsWritten: (out?.notified_rows ?? 0) + (out?.halted_rows ?? 0) + (imessage.enqueued ?? 0) + (imessage.applied ?? 0),
    metadata: {
      notified_users: out?.notified_users ?? 0,
      halted_users: out?.halted_users ?? 0,
      imessage_enqueued: imessage.enqueued ?? 0,
      imessage_applied: imessage.applied ?? 0,
    },
  };
}
