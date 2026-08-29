import { useCallback, useEffect, useState } from 'react';
import {
  fetchConnectorsCatalog,
  fetchConnectorTools,
  type ConnectorCatalogRow,
} from '../../../client-api/connectorsCatalog';
import { oauthConnectReturnTo } from '../../../src/lib/integrationOAuthPopup';

export function useConnectorsCatalog(workspaceId: string | null | undefined) {
  const [loading, setLoading] = useState(true);
  const [connectors, setConnectors] = useState<ConnectorCatalogRow[]>([]);
  const [connectedCount, setConnectedCount] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchConnectorsCatalog(oauthConnectReturnTo(), workspaceId || null);
      if (res.ok && res.connectors) {
        setConnectors(res.connectors);
        setConnectedCount(res.connected_count ?? res.connectors.filter((c) => c.connected).length);
      } else {
        setConnectors([]);
        setConnectedCount(0);
      }
    } catch {
      setConnectors([]);
      setConnectedCount(0);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadTools = useCallback(async (providerKey: string) => {
    const res = await fetchConnectorTools(providerKey);
    return res.ok ? res.tools || [] : [];
  }, []);

  return { loading, connectors, connectedCount, refresh, loadTools };
}
