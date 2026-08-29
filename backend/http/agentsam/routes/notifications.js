/**
 * Notifications routes extracted from handleAgentApi (mechanical move).
 * Ticket: tkt_43ac75f20fe24f33
 * Family: /api/agent/notifications, PATCH .../read
 *
 * @returns {Promise<Response|null>} Response if handled; null to continue dispatcher
 */
import { jsonResponse } from '../shared.js';
import { authUserFromRequest, fetchAuthUserTenantId, resolveCanonicalUserId } from '../../../identity/index.js';

function toUnixSeconds(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  if (Number.isFinite(n)) return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function formatRelativeCheckedAgo(ts) {
  const age = Math.max(0, Math.floor(Date.now() / 1000) - Number(ts || 0));
  if (age < 60) return 'just now';
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  if (age < 86400) return `${Math.floor(age / 3600)}h ago`;
  return `${Math.floor(age / 86400)}d ago`;
}

export async function handleAgentNotificationsApi(request, url, env, ctx, routeAuth, identity) {
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const ra =
    routeAuth && typeof routeAuth === 'object' && 'authCtx' in routeAuth
      ? routeAuth
      : { authUser: routeAuth, authCtx: null };

  // ── /api/agent/notifications (deployments + conversations + connectivity) ──
  if (path === '/api/agent/notifications' && method === 'GET') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

    let tenantId = authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
      ? String(authUser.tenant_id).trim()
      : null;
    if (!tenantId) tenantId = await fetchAuthUserTenantId(env, authUser.id);
    if (!tenantId && authUser.email) tenantId = await fetchAuthUserTenantId(env, authUser.email);

    const userId = String(authUser.id || '').trim();

    try {
      let deployRows = [];
      try {
        const q = await env.DB.prepare(
          `SELECT id, status, deployed_by, environment, worker_name,
                  triggered_by, git_hash, timestamp AS created_at
           FROM deployments
           ORDER BY timestamp DESC LIMIT 10`,
        ).all();
        deployRows = q.results || [];
      } catch {
        try {
          const q = await env.DB.prepare(
            `SELECT * FROM deployments ORDER BY COALESCE(created_at, 0) DESC LIMIT 10`,
          ).all();
          deployRows = q.results || [];
        } catch {
          deployRows = [];
        }
      }

      let convRows = [];
      if (tenantId && userId) {
        const canonicalUserId = await resolveCanonicalUserId(userId, env);
        if (canonicalUserId) {
          const q = await env.DB.prepare(
            `SELECT conversation_id AS id, title, message_count,
                    COALESCE(last_turn_at, updated_at) AS created_at, workspace_id
             FROM agentsam_chat_sessions
             WHERE user_id = ? AND tenant_id = ? AND COALESCE(is_archived, 0) = 0
             ORDER BY COALESCE(last_turn_at, updated_at) DESC LIMIT 20`,
          )
            .bind(canonicalUserId, tenantId)
            .all();
          convRows = q.results || [];
        }
      }

      let healthRows = [];
      if (tenantId) {
        try {
          const q = await env.DB.prepare(
            `SELECT wc.workspace_id, wc.service, wc.status,
                    wc.last_checked_at AS created_at, w.display_name
             FROM workspace_connectivity_status wc
             JOIN agentsam_workspace w ON w.id = wc.workspace_id
             WHERE wc.status IN ('degraded','down') AND w.tenant_id = ?
             LIMIT 10`,
          ).bind(tenantId).all();
          healthRows = q.results || [];
        } catch {
          healthRows = [];
        }
      }

      const normalized = [];

      // Canonical in-app inbox spine (D1 notifications) — daily digests / push / billing should land here.
      if (userId) {
        try {
          const inboxQ = await env.DB.prepare(
            `SELECT id, channel, subject, message, status, entity_type, entity_id,
                    priority, sent_at, read_at, created_at, data
             FROM notifications
             WHERE recipient_id = ?
             ORDER BY created_at DESC
             LIMIT 30`,
          ).bind(userId).all();
          for (const r of inboxQ.results || []) {
            const ts = toUnixSeconds(r.created_at ?? r.sent_at);
            const title =
              r.subject != null && String(r.subject).trim()
                ? String(r.subject).trim()
                : r.channel
                  ? `${String(r.channel)} notification`
                  : 'Notification';
            normalized.push({
              id: String(r.id),
              type: 'inbox',
              channel: r.channel ?? null,
              title,
              message: r.message != null ? String(r.message).slice(0, 400) : '',
              created_at: ts,
              read: r.read_at != null,
              status: r.status ?? null,
              meta: r,
              subject: title,
              href:
                (() => {
                  let fromData = null;
                  try {
                    const d =
                      typeof r.data === 'string'
                        ? JSON.parse(r.data)
                        : r.data && typeof r.data === 'object'
                          ? r.data
                          : null;
                    fromData = d?.url || d?.href || null;
                  } catch {
                    fromData = null;
                  }
                  if (fromData) return String(fromData);
                  if (r.entity_type === 'conversation' && r.entity_id) {
                    return `/dashboard/agent/${encodeURIComponent(String(r.entity_id))}`;
                  }
                  if (
                    r.entity_id &&
                    (r.entity_type === 'email' ||
                      r.entity_type === 'received_email' ||
                      r.entity_type === 'mail')
                  ) {
                    return `/dashboard/mail?email=${encodeURIComponent(String(r.entity_id))}&folder=inbox`;
                  }
                  if (r.channel === 'email') return '/dashboard/mail';
                  return null;
                })(),
            });
          }
        } catch {
          /* notifications table optional */
        }
      }

      // Delivery queue lives on /dashboard/mail → Outbound (notification_outbox).

      for (const r of deployRows) {
        const worker = r.worker_name != null ? String(r.worker_name) : 'worker';
        const gh = r.git_hash != null ? String(r.git_hash) : '';
        const trig = r.triggered_by != null ? String(r.triggered_by) : '';
        const st = r.status != null ? String(r.status) : '';
        const ts = toUnixSeconds(r.created_at ?? r.timestamp);
        normalized.push({
          id: `deploy:${r.id}`,
          type: 'deploy',
          title: `Deploy ${st}: ${worker}`,
          message: `${trig} · ${gh ? gh.slice(0, 7) : '—'}`,
          created_at: ts,
          read: false,
          meta: r,
          subject: `Deploy ${st}: ${worker}`,
        });
      }

      for (const r of convRows) {
        const ts = toUnixSeconds(r.created_at);
        const titleBase =
          r.title != null && String(r.title).trim()
            ? String(r.title).trim()
            : 'Untitled conversation';
        const mc = r.message_count != null ? Number(r.message_count) : 0;
        normalized.push({
          id: `conv:${r.id}`,
          type: 'conversation',
          title: titleBase,
          message: `${mc} messages`,
          created_at: ts,
          read: false,
          meta: r,
          subject: titleBase,
        });
      }

      for (const r of healthRows) {
        const ts = toUnixSeconds(r.created_at);
        const svc = r.service != null ? String(r.service) : 'service';
        const st = r.status != null ? String(r.status) : '';
        const dn = r.display_name != null ? String(r.display_name) : 'workspace';
        normalized.push({
          id: `health:${r.workspace_id}:${svc}`,
          type: 'health',
          title: `${svc} ${st} on ${dn}`,
          message: `Last checked ${formatRelativeCheckedAgo(ts)}`,
          created_at: ts,
          read: false,
          meta: r,
          subject: `${svc} ${st} on ${dn}`,
        });
      }

      if (tenantId) {
        try {
          const calQ = await env.DB.prepare(
            `SELECT id, title, description, start_datetime, end_datetime, event_type, status, color
             FROM calendar_events
             WHERE workspace_id IN (
               SELECT id FROM agentsam_workspace WHERE tenant_id = ? LIMIT 20
             )
               AND event_type IN ('billing_reminder', 'billing_period')
               AND date(start_datetime) <= date('now')
               AND datetime(start_datetime) >= datetime('now', '-14 days')
               AND status IN ('scheduled', 'reminded')
             ORDER BY start_datetime DESC
             LIMIT 10`,
          ).bind(tenantId).all();
          for (const r of calQ.results || []) {
            const ts = toUnixSeconds(r.start_datetime);
            const title = r.title != null ? String(r.title).trim() : 'Calendar reminder';
            const desc = r.description != null ? String(r.description).trim() : '';
            normalized.push({
              id: `cal:${r.id}`,
              type: 'billing',
              title,
              message: desc.slice(0, 240) || 'Billing reminder',
              created_at: ts || Math.floor(Date.now() / 1000),
              read: r.status === 'reminded',
              meta: r,
              subject: title,
            });
          }
        } catch {
          /* calendar_events optional */
        }
      }

      normalized.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      const top = normalized.slice(0, 50);
      return jsonResponse({ notifications: top });
    } catch (e) {
      return jsonResponse({ error: e?.message ?? String(e) }, 500);
    }
  }

  const notifReadMatch = path.match(/^\/api\/agent\/notifications\/([^/]+)\/read$/);
  if (notifReadMatch && method === 'PATCH') {
    const authUser = await authUserFromRequest(request, env, ra.authCtx, ra.authUser ?? null);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
    if (!env?.DB) return jsonResponse({ error: 'D1 unavailable' }, 503);
    const notifId = decodeURIComponent(notifReadMatch[1] || '').trim();
    const userId = String(authUser.id || '').trim();
    // Synthetic ids (deploy:/conv:/…) are UI-only — acknowledge without write.
    if (!notifId || notifId.includes(':')) {
      return jsonResponse({ success: true, synthetic: true });
    }
    try {
      await env.DB.prepare(
        `UPDATE notifications
         SET read_at = COALESCE(read_at, unixepoch()), status = CASE WHEN status = 'pending' THEN 'read' ELSE status END
         WHERE id = ? AND recipient_id = ?`,
      )
        .bind(notifId, userId)
        .run();
      return jsonResponse({ success: true });
    } catch (e) {
      return jsonResponse({ error: String(e?.message || e) }, 500);
    }
  }

  return null;
}
