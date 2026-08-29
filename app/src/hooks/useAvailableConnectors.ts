import { useCallback, useEffect, useState } from 'react';
import {
  fetchConnectorsCatalog,
  type ConnectorCatalogRow,
} from '../../client-api/connectorsCatalog';

const COMPOSER_CONNECTOR_KEYS = new Set([
  'github',
  'cloudflare_oauth',
  'supabase_oauth',
  'google_gmail',
  'gmail',
  'google_drive',
]);

export type ComposerAvailableConnector = {
  id: string;
  providerKey: string;
  name: string;
  description: string;
  iconUrl?: string | null;
  iconSlug?: string;
  connected: boolean;
  connectUrl: string | null;
};

function connectorDescription(row: ConnectorCatalogRow): string {
  const preview = row.tools_preview?.[0]?.description?.trim();
  if (preview) return preview;
  if (row.note?.trim()) return row.note.trim();
  if (row.connected && row.account_display?.trim()) return row.account_display.trim();
  if (row.tool_count > 0) return `${row.tool_count} tools available`;
  return 'Connect to enable in chat';
}

function mapConnectorRow(row: ConnectorCatalogRow): ComposerAvailableConnector {
  return {
    id: row.id,
    providerKey: row.provider_key,
    name: row.title,
    description: connectorDescription(row),
    iconUrl: row.icon_url,
    iconSlug: row.icon_slug,
    connected: row.connected,
    connectUrl: row.connect_url,
  };
}

export function useAvailableConnectors(workspaceId?: string | null) {
  const [connectors, setConnectors] = useState<ComposerAvailableConnector[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchConnectorsCatalog('/dashboard/agent', workspaceId);
      const rows = (res.connectors || []).filter((row) =>
        COMPOSER_CONNECTOR_KEYS.has(String(row.provider_key || '').toLowerCase()),
      );
      const deduped = new Map<string, ComposerAvailableConnector>();
      for (const row of rows) {
        const pk = String(row.provider_key || '').toLowerCase();
        if (pk === 'gmail') continue;
        deduped.set(pk, mapConnectorRow(row));
      }
      setConnectors([...deduped.values()]);
    } catch {
      setConnectors([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { connectors, loading, refresh };
}
