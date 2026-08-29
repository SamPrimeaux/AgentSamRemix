import React, { useCallback, useEffect, useState } from 'react';
import type { SettingsPanelModel } from '../hooks/useSettingsData';
import { Toggle } from '../settingsUi';
import {
  getIamWebPushEnabled,
  subscribeIamWebPush,
  unsubscribeIamWebPush,
} from '../../../src/pwa/registerServiceWorker';
import { useSettingsSectionStatus } from '../hooks/useSettingsSectionStatus';
import {
  ActionRow,
  DataTable,
  EmptyState,
  LoadingRow,
  RelTime,
  SectionHeader,
  SummaryGrid,
  WarningStrip,
} from '../components/SectionPrimitives';

export type NotificationsSectionProps = { data: SettingsPanelModel };

const NOTIFY_ROWS: { key: string; label: string; desc: string }[] = [
  {
    key: 'notify.deploy_success',
    label: 'Deployment Success',
    desc: 'When a deploy completes successfully',
  },
  {
    key: 'notify.deploy_failure',
    label: 'Deployment Failure',
    desc: 'When a deploy fails or errors',
  },
  {
    key: 'notify.agent_error',
    label: 'Agent Error',
    desc: 'When an agent run hits an unhandled error',
  },
  {
    key: 'notify.spend_threshold',
    label: 'Spend Alert',
    desc: 'When monthly spend exceeds your limit',
  },
  {
    key: 'notify.benchmark_fail',
    label: 'Benchmark Failure',
    desc: 'When a benchmark run regresses',
  },
];

const CHANNEL_ROWS: { key: string; label: string; desc: string }[] = [
  {
    key: 'notify.channel.email',
    label: 'Email',
    desc: 'Send alerts to the verified email on your account',
  },
  {
    key: 'notify.channel.push',
    label: 'Push notifications',
    desc: 'Deliver alerts to this browser or installed PWA',
  },
  {
    key: 'notify.channel.imessage',
    label: 'iMessage',
    desc: 'Use the connected Mac Messages relay when available',
  },
];

type ErrorRow = {
  id?: string;
  severity?: string;
  source?: string;
  message?: string;
  created_at?: string | number | null;
};

type EscalationRow = {
  id?: string;
  kind?: string;
  reason?: string;
  mode?: string;
  to_route_key?: string;
  status?: string;
  created_at_unix?: number | null;
};

type ApprovalRow = {
  id?: string;
  kind?: string;
  status?: string;
  requested_by?: string;
  created_at?: string | number | null;
};

type WebhookEventRow = {
  id?: string;
  source?: string;
  event_type?: string;
  status?: string;
  created_at?: string | number | null;
};

type IntegrationEventRow = {
  id?: string;
  slug?: string;
  event_type?: string;
  severity?: string;
  created_at?: string | number | null;
};

type NotificationsSummary = {
  recent_errors?: number;
  open_escalations?: number;
  pending_approvals?: number;
  recent_webhook_events?: number;
  recent_integration_events?: number;
};

type NotificationsExtra = {
  errors?: ErrorRow[];
  escalations?: EscalationRow[];
  approvals?: ApprovalRow[];
  webhook_events?: WebhookEventRow[];
  integration_events?: IntegrationEventRow[];
  preferences?: Record<string, string>;
  notification_email?: string;
  notification_email_source?: string;
};

async function saveNotifyUpdates(updates: Array<{ setting_key: string; setting_value: string }>) {
  const r = await fetch('/api/settings/notifications', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Save failed (${r.status})`);
  return j as {
    preferences?: Record<string, string>;
    notification_email?: string;
  };
}

export function NotificationsSection({ data }: NotificationsSectionProps) {
  const { data: section, loading, error, reload } = useSettingsSectionStatus({
    endpoint: '/api/settings/notifications',
  });
  const summary = (section?.summary || {}) as NotificationsSummary;
  const extra = (section?.extra || {}) as NotificationsExtra;
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const [pushBusy, setPushBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);

  // Hydrate local prefs from the section payload (D1-backed).
  useEffect(() => {
    const prefs = extra.preferences;
    if (!prefs || typeof prefs !== 'object') return;
    data.setNotifyPrefs(prefs);
    // intentionally depend on JSON snapshot of prefs, not `data` identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(extra.preferences || null)]);

  useEffect(() => {
    let active = true;
    void getIamWebPushEnabled().then((enabled) => {
      if (active) setPushEnabled(enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  const displayEmail =
    (extra.notification_email && String(extra.notification_email).trim()) ||
    data.profileEmail ||
    '—';

  const persistKey = useCallback(
    async (key: string, value: string) => {
      const prev = data.notifyPrefs;
      data.setNotifyPrefs((p) => ({ ...p, [key]: value }));
      try {
        const j = await saveNotifyUpdates([{ setting_key: key, setting_value: value }]);
        if (j.preferences) data.setNotifyPrefs(j.preferences);
      } catch (e) {
        data.setNotifyPrefs(prev);
        setActionMsg(e instanceof Error ? e.message : 'Save failed');
      }
    },
    [data],
  );

  const onAction = useCallback(
    async (key: string) => {
      setActionMsg(null);
      if (key === 'save_preferences') {
        setActionBusy(key);
        try {
          const updates = [
            ...NOTIFY_ROWS.map((row) => ({
              setting_key: row.key,
              setting_value: String(data.notifyPrefs[row.key] || 'false') === 'true' ? 'true' : 'false',
            })),
            ...CHANNEL_ROWS.map((row) => ({
              setting_key: row.key,
              setting_value: String(
                data.notifyPrefs[row.key] || (row.key === 'notify.channel.email' ? 'true' : 'false'),
              ) === 'true'
                ? 'true'
                : 'false',
            })),
          ];
          const j = await saveNotifyUpdates(updates);
          if (j.preferences) data.setNotifyPrefs(j.preferences);
          setActionMsg('Preferences saved.');
          await reload();
        } catch (e) {
          setActionMsg(e instanceof Error ? e.message : 'Save failed');
        } finally {
          setActionBusy(null);
        }
        return;
      }
      if (key === 'send_test_notification') {
        setActionBusy(key);
        try {
          const r = await fetch('/api/settings/notifications/test', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : `Test failed (${r.status})`);
          setActionMsg('Test notification sent through your enabled channels.');
        } catch (e) {
          setActionMsg(e instanceof Error ? e.message : 'Test send failed');
        } finally {
          setActionBusy(null);
        }
      }
    },
    [data, reload],
  );

  const onChannelChange = useCallback(
    async (key: string, enabled: boolean) => {
      setActionMsg(null);
      if (key === 'notify.channel.push') {
        setPushBusy(true);
        try {
          const ok = enabled ? await subscribeIamWebPush() : await unsubscribeIamWebPush();
          if (!ok) {
            setActionMsg(
              enabled
                ? 'Push permission or browser support is unavailable.'
                : 'Push subscription could not be removed.',
            );
            return;
          }
          setPushEnabled(enabled);
          await persistKey(key, enabled ? 'true' : 'false');
        } catch (e) {
          setActionMsg(e instanceof Error ? e.message : 'Push setup failed');
        } finally {
          setPushBusy(false);
        }
        return;
      }
      await persistKey(key, enabled ? 'true' : 'false');
    },
    [persistKey],
  );

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <SectionHeader
        title="Notifications"
        description="Choose which events matter and where the application should deliver them. Settings are stored on your account."
        right={
          <button
            type="button"
            onClick={() => reload()}
            disabled={loading}
            className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-muted hover:text-main disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {data.notifyError ? (
        <div className="text-[11px] text-[var(--color-danger)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 rounded-xl px-3 py-2">
          {data.notifyError}
        </div>
      ) : null}
      {error ? (
        <div className="text-[11px] text-[var(--color-danger)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 rounded-xl px-3 py-2">
          {error}
        </div>
      ) : null}
      {actionMsg ? (
        <div className="text-[11px] text-main border border-[var(--border-subtle)] bg-[var(--bg-panel)] rounded-xl px-3 py-2">
          {actionBusy ? `${actionBusy}: ` : ''}
          {actionMsg}
        </div>
      ) : null}
      {data.notifyLoading || (loading && !section) ? <LoadingRow /> : null}

      {section ? (
        <>
          <SummaryGrid
            items={[
              { label: 'Recent errors', value: String(summary.recent_errors ?? 0) },
              { label: 'Open escalations', value: String(summary.open_escalations ?? 0) },
              { label: 'Pending approvals', value: String(summary.pending_approvals ?? 0) },
              { label: 'Webhook events', value: String(summary.recent_webhook_events ?? 0) },
              { label: 'Integration events', value: String(summary.recent_integration_events ?? 0) },
            ]}
          />
          <WarningStrip warnings={section.warnings} />
          <ActionRow actions={section.actions} onAction={(k) => void onAction(k)} />
        </>
      ) : null}

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] overflow-hidden">
        <div className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-muted bg-[var(--bg-app)] border-b border-[var(--border-subtle)]">
          Delivery channels
        </div>
        {CHANNEL_ROWS.map((row) => {
          const preferenceDefault = row.key === 'notify.channel.email';
          const on =
            row.key === 'notify.channel.push'
              ? pushEnabled && String(data.notifyPrefs[row.key] || 'false') === 'true'
              : String(data.notifyPrefs[row.key] || (preferenceDefault ? 'true' : 'false')) === 'true';
          return (
            <div
              key={row.key}
              className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]"
            >
              <div className="min-w-0 pr-3">
                <div className="text-[12px] font-semibold text-main">{row.label}</div>
                <div className="text-[11px] text-muted mt-0.5">{row.desc}</div>
              </div>
              <Toggle
                on={on}
                disabled={row.key === 'notify.channel.push' && pushBusy}
                onChange={(v) => {
                  void onChannelChange(row.key, v);
                }}
              />
            </div>
          );
        })}
        <div className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-muted bg-[var(--bg-app)] border-y border-[var(--border-subtle)]">
          Event preferences
        </div>
        {NOTIFY_ROWS.map((row) => {
          const on = String(data.notifyPrefs[row.key] || 'false') === 'true';
          return (
            <div
              key={row.key}
              className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)]"
            >
              <div className="min-w-0 pr-3">
                <div className="text-[12px] font-semibold text-main">{row.label}</div>
                <div className="text-[11px] text-muted mt-0.5">{row.desc}</div>
              </div>
              <Toggle
                on={on}
                onChange={(v) => {
                  void persistKey(row.key, v ? 'true' : 'false');
                }}
              />
            </div>
          );
        })}

        <div className="px-4 py-4 border-t border-[var(--border-subtle)]">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted">
            Notification email
          </div>
          <div className="mt-2 text-[12px] text-main font-mono">{displayEmail}</div>
          <div className="mt-1 text-[10px] text-muted">
            Resolved from your account profile (read-only here). Change it via your signed-in identity.
          </div>
        </div>
      </div>

      {section ? (
        <section className="flex flex-col gap-3">
          <div className="text-[10px] font-black uppercase tracking-widest text-muted">
            Alert source feeds
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-widest text-muted">
                Recent errors (agentsam_error_log)
              </div>
              {(extra.errors || []).length === 0 ? (
                <EmptyState message="No recent errors logged." />
              ) : (
                <DataTable<ErrorRow>
                  emptyMessage="No errors."
                  rows={extra.errors || []}
                  columns={[
                    {
                      key: 'created_at',
                      label: 'When',
                      widthClass: 'minmax(0, 0.7fr)',
                      render: (r) => <RelTime value={r.created_at ?? null} />,
                    },
                    { key: 'severity', label: 'Type', widthClass: 'minmax(0, 0.5fr)' },
                    { key: 'source', label: 'Source', widthClass: 'minmax(0, 0.7fr)' },
                  ]}
                />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-widest text-muted">
                Open escalations (agentsam_escalation)
              </div>
              {(extra.escalations || []).length === 0 ? (
                <EmptyState message="No escalations recorded." />
              ) : (
                <DataTable<EscalationRow>
                  emptyMessage="No escalations."
                  rows={extra.escalations || []}
                  columns={[
                    {
                      key: 'created_at_unix',
                      label: 'When',
                      render: (r) => <RelTime value={r.created_at_unix ?? null} />,
                    },
                    { key: 'kind', label: 'Kind' },
                    { key: 'mode', label: 'Mode' },
                    { key: 'to_route_key', label: 'Lane' },
                    { key: 'status', label: 'Status' },
                  ]}
                />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-widest text-muted">
                Pending approvals (agentsam_approval_queue)
              </div>
              {(extra.approvals || []).length === 0 ? (
                <EmptyState message="No approvals pending." />
              ) : (
                <DataTable<ApprovalRow>
                  emptyMessage="No approvals."
                  rows={extra.approvals || []}
                  columns={[
                    {
                      key: 'created_at',
                      label: 'When',
                      render: (r) => <RelTime value={r.created_at ?? null} />,
                    },
                    { key: 'kind', label: 'Tool' },
                    { key: 'status', label: 'Status' },
                  ]}
                />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-widest text-muted">
                Webhook + integration events
              </div>
              {(extra.webhook_events || []).length + (extra.integration_events || []).length ===
              0 ? (
                <EmptyState message="No webhook or integration events." />
              ) : (
                <DataTable
                  emptyMessage="No events."
                  rows={[
                    ...(extra.webhook_events || []).map((r) => ({
                      ...r,
                      _kind: 'webhook',
                      _label: r.source || '—',
                    })),
                    ...(extra.integration_events || []).map((r) => ({
                      ...r,
                      _kind: 'integration',
                      _label: r.slug || '—',
                    })),
                  ]}
                  columns={[
                    {
                      key: 'created_at',
                      label: 'When',
                      render: (r) => (
                        <RelTime
                          value={(r as { created_at?: unknown }).created_at as string | number | null}
                        />
                      ),
                    },
                    {
                      key: '_kind',
                      label: 'Kind',
                    },
                    {
                      key: 'event_type',
                      label: 'Event',
                    },
                    {
                      key: '_label',
                      label: 'Source',
                    },
                  ]}
                />
              )}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
