import { useCallback, useEffect, useState } from 'react';

export type CmsConnectedIntegration = {
  providerKey: string;
  displayName: string;
  status: 'connected' | 'degraded' | 'auth_expired';
  accountDisplay?: string | null;
  iconSlug?: string | null;
  primaryColor?: string | null;
};

type SummaryProvider = {
  provider_key?: string;
  display_name?: string;
  status?: string;
  account_display?: string | null;
  provider_color_slug?: string | null;
  provider_color?: { primary_color?: string | null; icon_slug?: string | null } | null;
  sort_order?: number | null;
  is_enabled?: number | boolean | null;
};

const CONNECTED_STATUSES = new Set(['connected', 'degraded']);

export function useCmsConnectedIntegrations(enabled = true) {
  const [items, setItems] = useState<CmsConnectedIntegration[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/integrations/summary', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { providers?: SummaryProvider[] };
      const list = (data.providers || [])
        .filter((p) => {
          const status = String(p.status || '').toLowerCase();
          if (!CONNECTED_STATUSES.has(status)) return false;
          if (p.is_enabled === 0 || p.is_enabled === false) return false;
          return true;
        })
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map((p) => ({
          providerKey: String(p.provider_key || '').trim(),
          displayName: String(p.display_name || p.provider_key || 'Integration').trim(),
          status: (String(p.status || 'connected').toLowerCase() === 'degraded'
            ? 'degraded'
            : 'connected') as CmsConnectedIntegration['status'],
          accountDisplay: p.account_display || null,
          iconSlug: p.provider_color?.icon_slug || p.provider_color_slug || p.provider_key || null,
          primaryColor: p.provider_color?.primary_color || null,
        }))
        .filter((p) => p.providerKey);
      setItems(list);
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { items, loading, error, refresh, connectedCount: items.length };
}
