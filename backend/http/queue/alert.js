/**
 * Queue payload: { type: 'alert', severity, source, event, event_id, ts, ... }
 * Produced by MCP Resend hooks (bounce/complaint/failed) via MY_QUEUE.
 * Persist + operator notify; never leave as unhandled_message_type noise.
 */

import { ingestWebhookEventAndDispatch } from '../webhooks/ingest.js';
import { resolveCronWorkspaceId } from '../../jobs/cron-tenant.js';

/**
 * @param {any} env
 * @param {ExecutionContext} [ctx]
 * @param {Record<string, unknown>} body
 */
export async function handleQueueAlert(env, ctx, body) {
  const severity = String(body.severity || 'high').toLowerCase();
  const source = String(body.source || 'queue_alert').slice(0, 80);
  const event = String(body.event || body.event_type || 'alert').slice(0, 120);
  const eventId =
    body.event_id != null
      ? String(body.event_id).slice(0, 200)
      : body.eventId != null
        ? String(body.eventId).slice(0, 200)
        : null;
  const ts =
    typeof body.ts === 'number' && Number.isFinite(body.ts)
      ? Math.floor(body.ts > 1e12 ? body.ts / 1000 : body.ts)
      : Math.floor(Date.now() / 1000);

  const workspaceId = (await resolveCronWorkspaceId(env)) || null;

  // Durable audit (same lane as other webhooks) — no spam to console.warn.
  if (env?.DB) {
    try {
      await ingestWebhookEventAndDispatch(
        env,
        ctx,
        {
          tenantId: null,
          workspaceId,
          provider: source.startsWith('resend') ? 'resend' : 'internal',
          eventType: event,
          eventId,
          payload: body,
          endpointPath: '/queue/alert',
          signatureValid: true,
          metadata: {
            queue_alert: true,
            severity,
            source,
            ts_unix: ts,
          },
        },
        { skipDispatch: true },
      );
    } catch (e) {
      console.info('[queue alert] webhook_events persist failed', e?.message ?? e);
    }

    // In-app notification for high/critical Resend bounces (best-effort).
    if (
      (severity === 'high' || severity === 'critical') &&
      (event === 'email.bounced' ||
        event === 'email.complained' ||
        event === 'email.failed')
    ) {
      try {
        const subject = `Email ${event.replace(/^email\./, '')}`;
        const message = `${source}: ${event}${eventId ? ` (${eventId})` : ''}`;
        await env.DB.prepare(
          `INSERT INTO notifications (
             recipient_id, recipient_type, channel, subject, message, data,
             entity_type, entity_id, priority, status, created_at
           ) VALUES (?, 'user', 'in_app', ?, ?, ?, 'resend_alert', ?, ?, 'pending', ?)`,
        )
          .bind(
            'platform_ops',
            subject,
            message,
            JSON.stringify({ source, event, event_id: eventId, severity, ts }),
            eventId || event,
            severity === 'critical' ? 'high' : 'normal',
            ts,
          )
          .run();
      } catch (e) {
        // notifications schema / FK may reject platform_ops — audit row is enough
        console.info('[queue alert] notify skipped', e?.message ?? e);
      }
    }
  }

  console.info(
    '[queue alert]',
    JSON.stringify({ severity, source, event, event_id: eventId, ts }),
  );
  return { ok: true, severity, source, event, event_id: eventId };
}
