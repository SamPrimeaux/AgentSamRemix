import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  oauthConnectReturnTo,
  openIntegrationOAuthPopup,
} from '../../../src/lib/integrationOAuthPopup';
import { IntegrationDrawer } from '../components/IntegrationDrawer';
import '../components/IntegrationDrawer.css';
import { IntegrationIconTile } from '../components/IntegrationIconTile';
import type { CatalogRow, ConnectionRow } from '../components/IntegrationCard';
import {
  CLOUDFLARE_CAPABILITY_LABELS,
  catalogSlugForRegistry,
  canonicalCloudflareRegistryKey,
  isCloudflareFamilyKey,
  isSlugConnected,
  registrySlugForCatalog,
} from '../../../lib/integrationSlugAliases';
import {
  CfStackWizard,
  type CfStackConfig,
} from './CfStackWizard';

import '../../ui/AppIcon.css';

type ConnectedItem = {
  catalog: CatalogRow | null;
  connection: ConnectionRow | null;
  legacy: { is_connected?: number; last_used?: string } | null;
  iam_hosted: boolean;
  derived_status?: string;
  integration_status?: {
    connected?: boolean;
    error?: string;
    reconnect_required?: boolean;
  };
};

type DrawerTarget =
  | { kind: 'connected'; item: ConnectedItem; foldedCapabilities?: string[] }
  | { kind: 'available'; catalog: CatalogRow };

export type IntegrationsSectionProps = {
  userId?: string | null;
  workspaceId?: string | null;
  onOpenInMonaco?: (content: string, virtualPath: string) => void;
};

type TabId = 'connected' | 'available' | 'custom';

function integrationTileStatus(item: ConnectedItem): 'warning' | 'error' | null {
  const st = String(item.derived_status || item.connection?.status || '').toLowerCase();
  if (st === 'auth_expired') return 'error';
  if (st === 'degraded') return 'warning';
  if (item.integration_status?.error === 'token_expired') return 'error';
  if (item.integration_status?.error === 'tunnel_unreachable') return 'warning';
  if (item.integration_status?.reconnect_required) return 'error';
  return null;
}

function integrationSubtitle(item: ConnectedItem): string {
  const st = String(item.derived_status || item.connection?.status || '').toLowerCase();
  if (st === 'auth_expired') return 'Reconnect';
  if (item.integration_status?.reconnect_required) return 'Reconnect';
  if (st === 'degraded') return 'Degraded';
  if (st === 'connected') return 'Connected';
  return st ? st.replace(/_/g, ' ') : 'Available';
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error((j as { error?: string }).error || res.statusText || 'Request failed');
  }
  return j as T;
}

export function IntegrationsSection({
  workspaceId,
  onOpenInMonaco,
}: IntegrationsSectionProps) {
  const [tab, setTab] = useState<TabId>('connected');
  const [connected, setConnected] = useState<ConnectedItem[]>([]);
  const [connectedSlugs, setConnectedSlugs] = useState<Set<string>>(new Set());
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [customRows, setCustomRows] = useState<
    { id: string; provider_key: string; display_name: string; account_display?: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<string>('');
  const [cfStackConfig, setCfStackConfig] = useState<CfStackConfig | null>(null);
  const [cfWizardOpen, setCfWizardOpen] = useState(false);

  const [customName, setCustomName] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customAuth, setCustomAuth] = useState<'none' | 'bearer' | 'oauth'>('none');
  const [customBearer, setCustomBearer] = useState('');
  const [customBusy, setCustomBusy] = useState(false);
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);

  const loadConnected = useCallback(async () => {
    const data = await fetchJson<{
      items: ConnectedItem[];
      connected_slugs?: string[];
    }>('/api/settings/integrations/connected');
    setConnected(data.items || []);
    setConnectedSlugs(
      new Set(
        (data.connected_slugs || [])
          .map((s) => s.toLowerCase())
          .filter(Boolean),
      ),
    );
  }, []);

  const loadCatalog = useCallback(async () => {
    const data = await fetchJson<{ integrations: CatalogRow[] }>(
      '/api/catalog/integrations',
    );
    setCatalog(data.integrations || []);
  }, []);

  const loadCustom = useCallback(async () => {
    const data = await fetchJson<{ items: typeof customRows }>(
      '/api/settings/integrations/custom',
    );
    setCustomRows(data.items || []);
  }, []);

  const loadCfStackConfig = useCallback(async () => {
    try {
      // Account-wide SSOT (user_settings + OAuth) — not per-workspace.
      const data = await fetchJson<{
        stack?: CfStackConfig;
        settings_json?: CfStackConfig;
        stack_configured?: boolean;
        oauth_connected?: boolean;
      }>('/api/integrations/cloudflare/context');
      const stack = data.stack || data.settings_json || null;
      setCfStackConfig(
        stack ||
          (data.stack_configured || data.oauth_connected
            ? { cf_stack_configured_at: data.stack_configured ? Date.now() : undefined }
            : null),
      );
    } catch {
      setCfStackConfig(null);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const u = new URL(window.location.href);
      const oauthErr = u.searchParams.get('error');
      const detail = u.searchParams.get('detail');
      if (!oauthErr) return;
      const msg =
        oauthErr === 'invalid_scope'
          ? `Cloudflare OAuth scope rejected: ${detail || oauthErr}. Enable that scope on the OAuth client, or remove it from the request.`
          : oauthErr === 'missing_params'
            ? 'Cloudflare OAuth returned without an auth code (often invalid_scope). Check Integrations error detail and retry.'
            : detail || oauthErr;
      setErr(msg);
      u.searchParams.delete('error');
      u.searchParams.delete('detail');
      window.history.replaceState({}, '', `${u.pathname}${u.search}${u.hash}`);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        await loadConnected();
        if (cancelled) return;
        await Promise.all([
          loadCatalog().catch(() => {
            /* catalog may 500 if table missing */
          }),
          loadCfStackConfig().catch(() => {}),
        ]);
      } catch (e) {
        if (!cancelled) {
          setErr(String(e instanceof Error ? e.message : e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadConnected, loadCatalog, loadCfStackConfig]);

  useEffect(() => {
    if (tab === 'available') {
      loadCatalog().catch(() => {});
    }
    if (tab === 'custom') {
      loadCustom().catch(() => {});
    }
  }, [tab, loadCatalog, loadCustom]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const c of catalog) {
      if (c.category) s.add(String(c.category));
    }
    return Array.from(s).sort();
  }, [catalog]);

  const filteredCatalog = useMemo(() => {
    if (!catFilter) return catalog;
    return catalog.filter((c) => String(c.category) === catFilter);
  }, [catalog, catFilter]);

  const cfOAuthConnected = useMemo(
    () =>
      connected.some((item) => {
        const key = String(item.connection?.provider_key || item.catalog?.slug || '')
          .trim()
          .toLowerCase()
          .replace(/-/g, '_');
        if (key !== 'cloudflare_oauth' && key !== 'cloudflare') return false;
        const st = String(item.derived_status || item.connection?.status || '').toLowerCase();
        return st === 'connected' && item.integration_status?.connected !== false;
      }),
    [connected],
  );

  const connectedTiles = useMemo(() => {
    const tiles: Array<{
      key: string;
      title: string;
      iconSlug: string;
      imageUrl?: string | null;
      item: ConnectedItem;
      status: 'warning' | 'error' | null;
      subtitle: string;
      foldedCapabilities?: string[];
    }> = [];

    let cfPrimary: ConnectedItem | null = null;
    const cfCaps: string[] = [];
    const cfStatuses: Array<'warning' | 'error' | null> = [];

    for (const item of connected) {
      const rawKey = String(item.connection?.provider_key || item.catalog?.slug || '').trim();
      const key = rawKey.toLowerCase();
      if (isCloudflareFamilyKey(key)) {
        const label =
          CLOUDFLARE_CAPABILITY_LABELS[key] ||
          String(item.catalog?.name || item.connection?.display_name || key);
        if (!cfCaps.includes(label)) cfCaps.push(label);
        cfStatuses.push(integrationTileStatus(item));
        const isOauth = key === 'cloudflare_oauth' || key === 'cloudflare';
        if (!cfPrimary || isOauth) cfPrimary = item;
        continue;
      }
      tiles.push({
        key: rawKey || String(tiles.length),
        title: String(item.catalog?.name || item.connection?.display_name || rawKey),
        iconSlug: String(item.catalog?.icon_slug || catalogSlugForRegistry(rawKey) || rawKey),
        imageUrl: item.catalog?.icon_url,
        item,
        status: integrationTileStatus(item),
        subtitle: integrationSubtitle(item),
      });
    }

    if (cfPrimary) {
      const worst =
        cfStatuses.includes('error') ? 'error' : cfStatuses.includes('warning') ? 'warning' : null;
      const oauthStatus = cfOAuthConnected
        ? 'Connected'
        : cfPrimary &&
            ['auth_expired', 'disconnected'].includes(
              String(cfPrimary.derived_status || cfPrimary.connection?.status || '').toLowerCase(),
            )
          ? 'Reconnect'
          : 'Connect OAuth';
      tiles.unshift({
        key: canonicalCloudflareRegistryKey(),
        title: 'Cloudflare',
        iconSlug: 'cloudflare',
        imageUrl: cfPrimary.catalog?.icon_url || null,
        item: {
          ...cfPrimary,
          catalog: {
            ...(cfPrimary.catalog || {}),
            name: 'Cloudflare',
            slug: 'cloudflare',
            icon_slug: 'cloudflare',
            auth_type: 'oauth',
            description:
              cfPrimary.catalog?.description ||
              'Developer Platform OAuth — D1, R2, Workers, Pages, Vectorize, Images, Browser Rendering, and related CF APIs under one connection.',
          },
          connection: {
            ...(cfPrimary.connection || {}),
            provider_key: canonicalCloudflareRegistryKey(),
            display_name: 'Cloudflare',
            status: cfOAuthConnected
              ? 'connected'
              : String(cfPrimary.derived_status || cfPrimary.connection?.status || 'disconnected'),
          },
          derived_status: cfOAuthConnected
            ? 'connected'
            : String(cfPrimary.derived_status || cfPrimary.connection?.status || 'disconnected'),
        },
        status: cfOAuthConnected ? worst : 'error',
        subtitle: oauthStatus,
        foldedCapabilities: cfCaps,
      });
    }

    return tiles;
  }, [connected, cfOAuthConnected]);

  const availableCatalog = useMemo(() => {
    // Hide satellite CF catalog rows if any appear later — one Cloudflare tile only.
    return filteredCatalog.filter((row) => {
      const slug = String(row.slug || '').toLowerCase();
      if (!isCloudflareFamilyKey(slug)) return true;
      return slug === 'cloudflare';
    });
  }, [filteredCatalog]);

  const cfStackConfigured = Boolean(
    cfStackConfig?.cf_stack_configured_at ||
      cfStackConfig?.cf_d1_database_id ||
      cfStackConfig?.cf_worker_name ||
      cfStackConfig?.cf_account_id,
  );

  const onConnectOAuth = useCallback(
    async (slug: string) => {
      const returnTo = encodeURIComponent(oauthConnectReturnTo());
      const s = String(slug || '')
        .trim()
        .toLowerCase()
        .replace(/-/g, '_');
      // Cloudflare authorize must be top-level navigation. Popup OAuth yields a broken /
      // "phony" surface (login shim / Connected.Closing) instead of dash.cloudflare.com.
      if (s === 'cloudflare' || s === 'cloudflare_oauth') {
        window.location.assign(`/api/oauth/cloudflare/start?return_to=${returnTo}`);
        return;
      }
      const connectUrl = `/api/integrations/${encodeURIComponent(slug)}/connect?return_to=${returnTo}`;
      const result = await openIntegrationOAuthPopup(connectUrl, slug);
      if (result.ok) {
        await Promise.all([loadConnected(), loadCfStackConfig()]);
      }
    },
    [loadCfStackConfig, loadConnected],
  );

  const onConnectApiKey = useCallback(async (slug: string, apiKey: string) => {
    await fetchJson(`/api/integrations/${encodeURIComponent(slug)}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey }),
    });
    await loadConnected();
  }, [loadConnected]);

  const onDisconnect = useCallback(
    async (slug: string) => {
      await fetchJson(`/api/integrations/${encodeURIComponent(slug)}/disconnect`, {
        method: 'POST',
      });
      await loadConnected();
    },
    [loadConnected],
  );

  const onTest = useCallback(async (slug: string) => {
    const res = await fetch(
      `/api/settings/integrations/${encodeURIComponent(slug)}/test`,
      { method: 'POST', credentials: 'same-origin' },
    );
    const j = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      latency_ms?: number;
      error?: string;
    };
    if (!res.ok) {
      return { status: 'error', latency_ms: j.latency_ms, error: j.error || res.statusText };
    }
    return {
      status: j.ok ? 'connected' : 'degraded',
      latency_ms: j.latency_ms,
      error: j.error,
    };
  }, []);

  const saveCustomMcp = useCallback(async () => {
    setCustomBusy(true);
    try {
      await fetchJson('/api/settings/integrations/custom-mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: customName,
          endpoint_url: customUrl,
          auth_type: customAuth,
          bearer_token: customAuth === 'bearer' ? customBearer : undefined,
        }),
      });
      setCustomName('');
      setCustomUrl('');
      setCustomBearer('');
      await loadCustom();
      await loadConnected();
    } finally {
      setCustomBusy(false);
    }
  }, [customAuth, customBearer, customName, customUrl, loadCustom, loadConnected]);

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <div>
        <h2 className="text-[13px] font-bold text-[var(--text-heading)] uppercase tracking-widest">
          Integrations
        </h2>
        <p className="text-[11px] text-muted mt-1">
          Connect third-party services and MCP endpoints. OAuth completes in the provider window,
          then returns here.
        </p>
      </div>

      <div className="flex gap-1 border-b border-[var(--border-subtle)] pb-2">
        {(
          [
            ['connected', 'Connected'],
            ['available', 'Available'],
            ['custom', 'Custom'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`text-[11px] px-3 py-1.5 rounded-lg border ${
              tab === id
                ? 'border-[var(--solar-blue)] text-[var(--text-heading)] bg-[var(--bg-hover)]'
                : 'border-transparent text-muted hover:bg-[var(--bg-hover)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {err ? (
        <div className="text-[11px] text-[var(--accent-danger)]">{err}</div>
      ) : null}

      {loading && tab === 'connected' ? (
        <div className="text-[11px] text-muted">Loading connections…</div>
      ) : null}

      {tab === 'connected' ? (
        <div className="flex flex-col gap-4">
          {connectedTiles.length === 0 && !loading ? (
            <div className="text-[11px] text-muted">
              No integration rows for this workspace yet. Use Available to connect.
            </div>
          ) : null}
          {connectedTiles.length ? (
            <div className="iam-app-icon-grid max-w-4xl">
              {connectedTiles.map((tile) => (
                <IntegrationIconTile
                  key={tile.key}
                  title={tile.title}
                  iconSlug={tile.iconSlug}
                  imageUrl={tile.imageUrl}
                  status={tile.status}
                  subtitle={tile.subtitle}
                  onClick={() =>
                    setDrawer({
                      kind: 'connected',
                      item: tile.item,
                      foldedCapabilities: tile.foldedCapabilities,
                    })
                  }
                />
              ))}
            </div>
          ) : null}
          {connectedTiles.length ? (
            <p className="text-[10px] text-muted">
              Tap an app icon to open health, reconnect, and connection details.
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === 'available' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`text-[10px] px-2 py-1 rounded-full border ${
                !catFilter
                  ? 'border-[var(--solar-blue)] text-[var(--text-heading)]'
                  : 'border-[var(--border-subtle)] text-muted'
              }`}
              onClick={() => setCatFilter('')}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className={`text-[10px] px-2 py-1 rounded-full border ${
                  catFilter === c
                    ? 'border-[var(--solar-blue)] text-[var(--text-heading)]'
                    : 'border-[var(--border-subtle)] text-muted'
                }`}
                onClick={() => setCatFilter(c)}
              >
                {c}
              </button>
            ))}
          </div>
          {availableCatalog.length === 0 ? (
            <div className="text-[11px] text-muted">
              No catalog entries returned. Ensure integration_catalog is populated in D1.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="iam-app-icon-grid max-w-4xl">
                {availableCatalog.map((row) => {
                  const slug = String(row.slug || '').toLowerCase();
                  const isConn = isSlugConnected(slug, connectedSlugs);
                  const isIam =
                    String(row.category || '').toLowerCase() === 'iam_hosted' ||
                    ['agentsam', 'autodidact'].includes(slug);
                  const title =
                    slug === 'cloudflare' ? 'Cloudflare' : String(row.name || slug);
                  return (
                    <IntegrationIconTile
                      key={slug || String(row.id)}
                      title={title}
                      iconSlug={row.icon_slug || slug}
                      imageUrl={row.icon_url}
                      subtitle={isConn ? 'Connected' : isIam ? 'Hosted' : 'Connect'}
                      onClick={() => {
                        const oauthReady = isSlugConnected(slug, connectedSlugs);
                        // CF satellites (R2/Images) can be "connected" while OAuth is not —
                        // still start the real top-level CF OAuth flow.
                        if (
                          isCloudflareFamilyKey(slug) &&
                          slug === 'cloudflare' &&
                          !oauthReady
                        ) {
                          void onConnectOAuth('cloudflare');
                          return;
                        }
                        if (isIam || isConn) {
                          if (isConn) {
                            const registryKey = isCloudflareFamilyKey(slug)
                              ? canonicalCloudflareRegistryKey()
                              : registrySlugForCatalog(slug);
                            const tile = connectedTiles.find((t) => t.key === registryKey);
                            if (tile) {
                              setDrawer({
                                kind: 'connected',
                                item: tile.item,
                                foldedCapabilities: tile.foldedCapabilities,
                              });
                              setTab('connected');
                              return;
                            }
                          }
                          setDrawer({
                            kind: 'available',
                            catalog: { ...row, name: title },
                          });
                          return;
                        }
                        void onConnectOAuth(slug);
                      }}
                    />
                  );
                })}
              </div>
              <p className="text-[10px] text-muted">
                Tap an icon to connect OAuth or open connection details in the side panel.
              </p>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'custom' ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-4 flex flex-col gap-3">
            <div className="text-[12px] font-semibold text-[var(--text-heading)]">
              Add custom MCP
            </div>
            <label className="text-[10px] text-muted flex flex-col gap-1">
              Display name
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="px-2 py-1.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[12px]"
              />
            </label>
            <label className="text-[10px] text-muted flex flex-col gap-1">
              Endpoint URL (https)
              <input
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://example.com/mcp"
                className="px-2 py-1.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[12px] font-mono"
              />
            </label>
            <label className="text-[10px] text-muted flex flex-col gap-1">
              Auth
              <select
                value={customAuth}
                onChange={(e) =>
                  setCustomAuth(e.target.value as 'none' | 'bearer' | 'oauth')
                }
                className="px-2 py-1.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[12px]"
              >
                <option value="none">None</option>
                <option value="bearer">Bearer token</option>
                <option value="oauth">OAuth (stored as connection placeholder)</option>
              </select>
            </label>
            {customAuth === 'bearer' ? (
              <label className="text-[10px] text-muted flex flex-col gap-1">
                Bearer token
                <input
                  type="password"
                  value={customBearer}
                  onChange={(e) => setCustomBearer(e.target.value)}
                  className="px-2 py-1.5 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-subtle)] text-[12px]"
                />
              </label>
            ) : null}
            <button
              type="button"
              disabled={customBusy}
              onClick={() => void saveCustomMcp()}
              className="text-[11px] px-3 py-2 rounded-lg bg-[var(--solar-blue)] text-[var(--toggle-knob)] w-fit"
            >
              {customBusy ? 'Saving…' : 'Test and save'}
            </button>
          </div>

          <div className="text-[11px] font-semibold text-[var(--text-heading)]">
            Custom MCP connections
          </div>
          {customRows.length === 0 ? (
            <div className="text-[11px] text-muted">None yet.</div>
          ) : (
            <ul className="text-[11px] text-main space-y-1">
              {customRows.map((r) => (
                <li key={r.id} className="flex justify-between gap-2 border-b border-[var(--border-subtle)] pb-1">
                  <span>{r.display_name || r.provider_key}</span>
                  <span className="text-muted truncate font-mono text-[10px]">
                    {r.account_display || r.provider_key}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <CfStackWizard
        open={cfWizardOpen}
        workspaceId={workspaceId?.trim() || undefined}
        onClose={() => setCfWizardOpen(false)}
        onComplete={() => void loadCfStackConfig()}
      />

      {drawer?.kind === 'connected' ? (
        <IntegrationDrawer
          open
          onClose={() => setDrawer(null)}
          title={String(
            drawer.item.catalog?.name ||
              drawer.item.connection?.display_name ||
              'Integration',
          )}
          mode="connected"
          catalog={drawer.item.catalog}
          connection={drawer.item.connection}
          legacy={drawer.item.legacy}
          iamHosted={drawer.item.iam_hosted}
          onConnectOAuth={onConnectOAuth}
          onConnectApiKey={onConnectApiKey}
          onDisconnect={async (slug) => {
            await onDisconnect(slug);
            setDrawer(null);
          }}
          onTest={onTest}
          onOpenInMonaco={onOpenInMonaco}
          showCfStack={isCloudflareFamilyKey(
            String(drawer.item.connection?.provider_key || drawer.item.catalog?.slug || ''),
          )}
          cfOAuthConnected={cfOAuthConnected}
          cfStackConfigured={cfStackConfigured}
          cfStackConfig={cfStackConfig}
          workspaceId={workspaceId}
          onOpenCfWizard={() => setCfWizardOpen(true)}
          foldedCapabilities={drawer.foldedCapabilities}
        />
      ) : null}

      {drawer?.kind === 'available' ? (
        <IntegrationDrawer
          open
          onClose={() => setDrawer(null)}
          title={String(drawer.catalog.name || drawer.catalog.slug || 'Integration')}
          mode="available"
          catalog={drawer.catalog}
          connection={null}
          connected={isSlugConnected(String(drawer.catalog.slug || ''), connectedSlugs)}
          iamHosted={
            String(drawer.catalog.category || '').toLowerCase() === 'iam_hosted' ||
            ['agentsam', 'autodidact'].includes(String(drawer.catalog.slug || '').toLowerCase())
          }
          onConnectOAuth={onConnectOAuth}
          onConnectApiKey={onConnectApiKey}
        />
      ) : null}
    </div>
  );
}
