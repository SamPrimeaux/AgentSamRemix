import React, { useCallback, useState } from 'react';
import { LocalTerminalSettingsPanel } from '../../LocalTerminalSetup';
import type { SettingsPanelModel } from '../hooks/useSettingsData';
import { useSettingsSectionStatus } from '../hooks/useSettingsSectionStatus';
import {
  DataTable,
  EmptyState,
  LoadingRow,
  RelTime,
  SectionHeader,
  SummaryGrid,
  WarningStrip,
} from '../components/SectionPrimitives';

export type NetworkSectionProps = { data: SettingsPanelModel; workspaceId?: string | null };

type DomainRow = {
  workspace_id?: string;
  domain?: string;
  status?: string;
  verified_at?: string | number | null;
  created_at?: string | number | null;
};

type AllowlistRow = {
  host?: string;
  risk_level?: string | null;
  created_at?: string | number | null;
};

type TrustedOriginRow = {
  origin?: string;
  scope?: string;
  created_at?: string | number | null;
};

type IntegrationEndpointRow = {
  slug?: string;
  display_name?: string;
  base_url?: string | null;
  auth_type?: string;
  is_active?: number;
  status?: string;
};

type NetworkSummary = {
  fetch_allowlist_count?: number;
  trusted_origins_count?: number;
  workspace_domains_count?: number;
  integration_endpoints_count?: number;
  worker_base_url?: string | null;
};

type NetworkExtra = {
  fetch_allowlist?: AllowlistRow[];
  trusted_origins?: TrustedOriginRow[];
  integration_endpoints?: IntegrationEndpointRow[];
};

export function NetworkSection({ data, workspaceId }: NetworkSectionProps) {
  const worker = data.workerBaseUrl?.trim() || '';
  const ws = workspaceId?.trim() || '';
  const { data: section, loading, error, reload } = useSettingsSectionStatus<DomainRow>({
    endpoint: '/api/settings/network',
    workspaceId: ws || null,
  });

  const [showAddDomain, setShowAddDomain] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [domainActionError, setDomainActionError] = useState<string | null>(null);
  const [domainActionBusy, setDomainActionBusy] = useState(false);
  const [domainActionSuccess, setDomainActionSuccess] = useState<string | null>(null);

  const summary = (section?.summary || {}) as NetworkSummary;
  const extra = (section?.extra || {}) as NetworkExtra;

  const domainsEndpoint = useCallback(() => {
    const base = '/api/settings/network/domains';
    return ws ? `${base}?workspace_id=${encodeURIComponent(ws)}` : base;
  }, [ws]);

  const submitAddDomain = useCallback(async () => {
    const domain = newDomain.trim().toLowerCase();
    if (!domain) {
      setDomainActionError('Enter a domain hostname');
      return;
    }
    if (!ws) {
      setDomainActionError('Select a workspace first');
      return;
    }
    setDomainActionBusy(true);
    setDomainActionError(null);
    setDomainActionSuccess(null);
    try {
      const r = await fetch(domainsEndpoint(), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, workspace_id: ws }),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!r.ok || j.ok === false) {
        throw new Error(typeof j.error === 'string' ? j.error : `Add failed (${r.status})`);
      }
      setNewDomain('');
      setShowAddDomain(false);
      setDomainActionSuccess(`Added ${domain}`);
      await reload();
    } catch (e) {
      setDomainActionError(e instanceof Error ? e.message : 'Failed to add domain');
    } finally {
      setDomainActionBusy(false);
    }
  }, [domainsEndpoint, newDomain, reload, ws]);

  const removeDomain = useCallback(
    async (domain: string) => {
      if (!ws) {
        setDomainActionError('Select a workspace first');
        return;
      }
      setDomainActionBusy(true);
      setDomainActionError(null);
      setDomainActionSuccess(null);
      try {
        const r = await fetch(domainsEndpoint(), {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain, workspace_id: ws }),
        });
        const j = (await r.json().catch(() => ({}))) as { error?: string; ok?: boolean };
        if (!r.ok || j.ok === false) {
          throw new Error(typeof j.error === 'string' ? j.error : `Remove failed (${r.status})`);
        }
        setDomainActionSuccess(`Removed ${domain}`);
        await reload();
      } catch (e) {
        setDomainActionError(e instanceof Error ? e.message : 'Failed to remove domain');
      } finally {
        setDomainActionBusy(false);
      }
    },
    [domainsEndpoint, reload, ws],
  );

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <LocalTerminalSettingsPanel workspaceId={workspaceId ?? undefined} />

      <SectionHeader
        title="Network"
        description="Workspace domains, fetch/origin allowlists, and integration endpoint registry."
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

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3">
        <div className="text-[10px] uppercase tracking-widest text-muted font-semibold">
          Worker base URL
        </div>
        <code className="text-[12px] font-mono break-all text-[var(--solar-blue)] mt-1 block">
          {worker || (summary.worker_base_url as string | undefined) || 'Not configured'}
        </code>
      </div>

      {error ? (
        <div className="text-[11px] text-[var(--color-danger)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 rounded-xl px-3 py-2">
          {error}
        </div>
      ) : null}
      {loading && !section ? <LoadingRow /> : null}

      {section ? (
        <>
          <SummaryGrid
            items={[
              { label: 'Workspace domains', value: String(summary.workspace_domains_count ?? 0) },
              { label: 'Fetch allowlist', value: String(summary.fetch_allowlist_count ?? 0) },
              { label: 'Trusted origins', value: String(summary.trusted_origins_count ?? 0) },
              { label: 'Integration endpoints', value: String(summary.integration_endpoints_count ?? 0) },
            ]}
          />

          <WarningStrip warnings={section.warnings} />

          {domainActionError ? (
            <div className="text-[11px] text-[var(--color-danger)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 rounded-xl px-3 py-2">
              {domainActionError}
            </div>
          ) : null}
          {domainActionSuccess ? (
            <div className="text-[11px] text-[var(--color-success)] border border-[var(--color-success)]/30 bg-[var(--color-success)]/5 rounded-xl px-3 py-2">
              {domainActionSuccess}
            </div>
          ) : null}

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-muted">
                Workspace domains
              </div>
              <button
                type="button"
                disabled={!ws || domainActionBusy}
                onClick={() => {
                  setShowAddDomain((v) => !v);
                  setDomainActionError(null);
                  setDomainActionSuccess(null);
                }}
                className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-muted hover:text-main disabled:opacity-50"
                title={ws ? 'Add a workspace domain' : 'Select a workspace to add domains'}
              >
                {ws ? '+ Add domain' : 'Select a workspace to add domains'}
              </button>
            </div>

            {showAddDomain && ws ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3">
                <input
                  type="text"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitAddDomain();
                  }}
                  placeholder="example.com"
                  className="flex-1 min-w-[180px] text-[12px] px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] text-main"
                  disabled={domainActionBusy}
                />
                <button
                  type="button"
                  onClick={() => void submitAddDomain()}
                  disabled={domainActionBusy || !newDomain.trim()}
                  className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--solar-blue)]/40 text-[var(--solar-blue)] hover:bg-[var(--solar-blue)]/10 disabled:opacity-50"
                >
                  {domainActionBusy ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddDomain(false);
                    setNewDomain('');
                    setDomainActionError(null);
                  }}
                  disabled={domainActionBusy}
                  className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-muted hover:text-main disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            ) : null}

            {(section.rows || []).length === 0 ? (
              <EmptyState message="No rows in workspace_domains for this workspace." />
            ) : (
              <DataTable<DomainRow>
                emptyMessage="No domains."
                rows={(section.rows || []) as DomainRow[]}
                columns={[
                  { key: 'domain', label: 'Domain', widthClass: 'minmax(0, 1.5fr)' },
                  { key: 'status', label: 'Status', widthClass: 'minmax(0, 0.5fr)' },
                  {
                    key: 'verified_at',
                    label: 'Verified',
                    widthClass: 'minmax(0, 0.7fr)',
                    render: (row) => <RelTime value={row.verified_at ?? null} />,
                  },
                  {
                    key: 'created_at',
                    label: 'Added',
                    widthClass: 'minmax(0, 0.7fr)',
                    render: (row) => <RelTime value={row.created_at ?? null} />,
                  },
                  {
                    key: 'actions',
                    label: '',
                    widthClass: 'minmax(0, 0.5fr)',
                    render: (row) =>
                      row.domain ? (
                        <button
                          type="button"
                          disabled={!ws || domainActionBusy}
                          onClick={() => void removeDomain(String(row.domain))}
                          className="text-[10px] px-2 py-1 rounded border border-[var(--color-danger)]/30 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/5 disabled:opacity-50"
                        >
                          Remove
                        </button>
                      ) : null,
                  },
                ]}
              />
            )}
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-muted">
                Trusted browser origins
              </div>
              {(extra.trusted_origins || []).length === 0 ? (
                <EmptyState message="No agentsam_browser_trusted_origin rows." />
              ) : (
                <DataTable<TrustedOriginRow>
                  emptyMessage="No origins."
                  rows={extra.trusted_origins || []}
                  columns={[
                    { key: 'origin', label: 'Origin' },
                    { key: 'scope', label: 'Trust scope' },
                  ]}
                />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-muted">
                Fetch domain allowlist
              </div>
              {(extra.fetch_allowlist || []).length === 0 ? (
                <EmptyState message="No agentsam_fetch_domain_allowlist rows." />
              ) : (
                <DataTable<AllowlistRow>
                  emptyMessage="No hosts."
                  rows={extra.fetch_allowlist || []}
                  columns={[
                    { key: 'host', label: 'Host' },
                    { key: 'risk_level', label: 'Risk' },
                  ]}
                />
              )}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted">
              Integration endpoints (registry)
            </div>
            {(extra.integration_endpoints || []).length === 0 ? (
              <EmptyState message="No integration_registry rows." />
            ) : (
              <DataTable<IntegrationEndpointRow>
                emptyMessage="No endpoints."
                rows={extra.integration_endpoints || []}
                columns={[
                  { key: 'display_name', label: 'Provider', widthClass: 'minmax(0, 1fr)' },
                  { key: 'base_url', label: 'Account', widthClass: 'minmax(0, 1.5fr)' },
                  { key: 'auth_type', label: 'Auth', widthClass: 'minmax(0, 0.5fr)' },
                  {
                    key: 'is_active',
                    label: 'Enabled',
                    widthClass: 'minmax(0, 0.4fr)',
                    render: (row) => (Number(row.is_active) === 1 ? 'yes' : 'no'),
                  },
                ]}
              />
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
