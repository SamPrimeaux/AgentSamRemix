import { notifySam } from '../http/agentsam/routes/git-notifications-runtime.js';

/**
 * Daily: email + mark reminded for calendar billing_reminder events due today.
 * In-app bell feed is handled by GET /api/agent/notifications (calendar slice).
 */
export async function runBillingReminderCron(env, ctx) {
  if (!env?.DB) return { rowsRead: 0, rowsWritten: 0 };

  let rowsRead = 0;
  let rowsWritten = 0;

  try {
    const { results } = await env.DB.prepare(
      `SELECT id, title, description, start_datetime, workspace_id, tenant_id
       FROM calendar_events
       WHERE event_type = 'billing_reminder'
         AND status = 'scheduled'
         AND date(start_datetime) = date('now')`,
    ).all();
    rowsRead = (results || []).length;

    for (const row of results || []) {
      const title = String(row.title || 'Billing reminder').trim();
      const body = String(row.description || '').trim() || title;
      await notifySam(
        env,
        {
          subject: title,
          body: `${body}\n\nOpen calendar: https://inneranimalmedia.com/dashboard/collaborate`,
          category: 'billing',
        },
        ctx,
      );
      await env.DB.prepare(
        `UPDATE calendar_events SET status = 'reminded', updated_at = datetime('now') WHERE id = ?`,
      )
        .bind(String(row.id))
        .run();
      rowsWritten += 1;
    }
  } catch (e) {
    console.warn('[cron] billing reminder', e?.message ?? e);
  }

  return { rowsRead, rowsWritten };
}
