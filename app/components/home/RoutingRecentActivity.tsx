/**
 * Home Recent activity — routing decisions + agent notifications.
 * Polls every 45s while mounted; refresh on focus.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, GitBranch, RefreshCw } from 'lucide-react';
import { agentConversationPath } from '../../lib/agentRoutes';
import './RoutingRecentActivity.css';

type TabId = 'routing' | 'notifications';

type RoutingDecision = {
  id: string;
  task_type: string | null;
  matched_by: string | null;
  is_match: boolean;
  confidence: number | null;
  model_key: string | null;
  provider: string | null;
  routing_arm_id: string | null;
  reason: string | null;
  message_excerpt: string | null;
  latency_ms: number | null;
  conversation_id: string | null;
  workspace_id: string | null;
  created_at: string | number | null;
};

type AgentNotification = {
  id: string;
  title?: string | null;
  subject?: string | null;
  message?: string | null;
  status?: string | null;
  created_at?: string | number | null;
  href?: string | null;
  url?: string | null;
};

function relativeTime(raw: string | number | null | undefined): string {
  if (raw == null) return '';
  let t: number;
  if (typeof raw === 'number') {
    t = raw < 1e12 ? raw * 1000 : raw;
  } else {
    const n = Number(raw);
    if (Number.isFinite(n) && String(raw).trim() !== '' && !String(raw).includes('-') && !String(raw).includes('T')) {
      t = n < 1e12 ? n * 1000 : n;
    } else {
      t = Date.parse(raw);
    }
  }
  if (!Number.isFinite(t)) return '';
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function shortModel(key: string | null): string {
  if (!key) return '—';
  const k = key.replace(/^models\//, '');
  if (k.length <= 32) return k;
  return `${k.slice(0, 30)}…`;
}

function taskLabel(task: string | null, matched: string | null): string {
  const t = (task || 'unknown').replace(/_/g, ' ');
  const m = matched ? ` · ${matched}` : '';
  return `${t}${m}`;
}

export function RoutingRecentActivity() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabId>('routing');
  const [rows, setRows] = useState<RoutingDecision[]>([]);
  const [notifs, setNotifs] = useState<AgentNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const [rRes, nRes] = await Promise.all([
        fetch('/api/agent/routing/recent?limit=10', { credentials: 'include' }),
        fetch('/api/agent/notifications', { credentials: 'include' }),
      ]);
      if (!rRes.ok) throw new Error(`routing HTTP ${rRes.status}`);
      const rData = (await rRes.json()) as { decisions?: RoutingDecision[]; error?: string };
      if (rData.error) throw new Error(rData.error);
      setRows(Array.isArray(rData.decisions) ? rData.decisions : []);

      if (nRes.ok) {
        const nData = (await nRes.json()) as { notifications?: AgentNotification[] };
        setNotifs(Array.isArray(nData.notifications) ? nData.notifications.slice(0, 12) : []);
      }
      setUpdatedAt(Date.now());
    } catch (e) {
      if (!silent) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const id = window.setInterval(() => void load(true), 45_000);
    const onFocus = () => void load(true);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  const unreadNotifs = notifs.filter(
    (n) => String(n.status || '').toLowerCase() !== 'read',
  ).length;

  return (
    <div className="iam-activity-panel">
      <div className="iam-activity-panel__toolbar">
        <div className="iam-activity-panel__tabs" role="tablist" aria-label="Activity type">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'routing'}
            className={`iam-activity-panel__tab${tab === 'routing' ? ' is-active' : ''}`}
            onClick={() => setTab('routing')}
          >
            <GitBranch size={14} strokeWidth={1.75} aria-hidden />
            Routing
            <span className="iam-activity-panel__count">{rows.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'notifications'}
            className={`iam-activity-panel__tab${tab === 'notifications' ? ' is-active' : ''}`}
            onClick={() => setTab('notifications')}
          >
            <Bell size={14} strokeWidth={1.75} aria-hidden />
            Notifications
            {unreadNotifs > 0 ? (
              <span className="iam-activity-panel__count iam-activity-panel__count--alert">{unreadNotifs}</span>
            ) : (
              <span className="iam-activity-panel__count">{notifs.length}</span>
            )}
          </button>
        </div>
        <button
          type="button"
          className="iam-activity-panel__refresh"
          onClick={() => void load(false)}
          title="Refresh"
          aria-label="Refresh activity"
        >
          <RefreshCw size={14} strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      <p className="iam-activity-panel__hint">
        {tab === 'routing'
          ? 'Live D1 routing decisions — updates every 45s and on window focus.'
          : 'Deployments, chats, and connectivity alerts from /api/agent/notifications.'}
        {updatedAt ? ` · Updated ${relativeTime(updatedAt)}` : ''}
      </p>

      {loading ? (
        <p className="iam-activity-panel__empty">Loading…</p>
      ) : error ? (
        <p className="iam-activity-panel__empty">Couldn’t load ({error}).</p>
      ) : tab === 'routing' ? (
        rows.length === 0 ? (
          <p className="iam-activity-panel__empty">No routing decisions yet — send a chat to see rows appear.</p>
        ) : (
          <ul className="iam-activity-panel__list">
            {rows.map((r) => (
              <li key={r.id} className="iam-activity-panel__row">
                <div className="iam-activity-panel__row-top">
                  <span className="iam-activity-panel__badge">{taskLabel(r.task_type, r.matched_by)}</span>
                  <time className="iam-activity-panel__time">{relativeTime(r.created_at)}</time>
                </div>
                {r.message_excerpt ? (
                  <p className="iam-activity-panel__excerpt">{r.message_excerpt}</p>
                ) : null}
                <div className="iam-activity-panel__meta">
                  <span className="iam-activity-panel__model" title={r.model_key || undefined}>
                    {shortModel(r.model_key)}
                  </span>
                  {r.latency_ms != null ? <span>{r.latency_ms}ms</span> : null}
                  {r.confidence != null ? (
                    <span>{Math.round(Number(r.confidence) * 100)}%</span>
                  ) : null}
                  {r.conversation_id ? (
                    <button
                      type="button"
                      className="iam-activity-panel__link"
                      onClick={() => navigate(agentConversationPath(r.conversation_id!))}
                    >
                      Open chat
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )
      ) : notifs.length === 0 ? (
        <p className="iam-activity-panel__empty">No notifications right now.</p>
      ) : (
        <ul className="iam-activity-panel__list">
          {notifs.map((n) => {
            const title = n.title || n.subject || 'Notification';
            let target = n.href || n.url || null;
            if (!target && typeof n.id === 'string') {
              if (n.id.startsWith('conv:')) {
                target = agentConversationPath(n.id.slice(5));
              } else if (n.id.startsWith('deploy:')) {
                target = '/dashboard/settings/plan';
              } else if (n.id.startsWith('health:')) {
                target = '/dashboard/analytics';
              } else if (n.id.startsWith('outbox:') || n.channel === 'email') {
                target = '/dashboard/settings/notifications';
              }
            }
            return (
              <li key={n.id} className="iam-activity-panel__row">
                <div className="iam-activity-panel__row-top">
                  <span className="iam-activity-panel__badge iam-activity-panel__badge--notif">
                    {title}
                  </span>
                  <time className="iam-activity-panel__time">{relativeTime(n.created_at)}</time>
                </div>
                {n.message ? <p className="iam-activity-panel__excerpt">{n.message}</p> : null}
                <div className="iam-activity-panel__meta">
                  {n.status ? <span>{n.status}</span> : null}
                  {target ? (
                    <button
                      type="button"
                      className="iam-activity-panel__link"
                      onClick={() => {
                        if (target.startsWith('http')) window.location.href = target;
                        else navigate(target);
                      }}
                    >
                      Inspect
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="iam-activity-panel__link"
                      onClick={() => navigate('/dashboard/settings/notifications')}
                    >
                      Settings
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
