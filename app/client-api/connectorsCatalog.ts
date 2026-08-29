export type ConnectorCatalogRow = {
  id: string;
  provider_key: string;
  connect_slug: string;
  catalog_slug: string;
  title: string;
  icon_slug: string;
  icon_url?: string | null;
  category: string;
  kind: 'oauth_api' | 'mcp_remote' | 'mcp_custom' | 'capability';
  status: string;
  connected: boolean;
  issue: 'warning' | 'error' | null;
  account_display: string | null;
  tool_count: number;
  tools_preview: { key: string; label: string; description: string | null }[];
  connect_url: string | null;
  settings_path: string;
  oauth_scopes: string[];
  note?: string;
};

export type ConnectorsCatalogResponse = {
  ok: boolean;
  connectors?: ConnectorCatalogRow[];
  connected_count?: number;
  fresh_session_defaults?: {
    exec_lane: string;
    tool_access_mode: string;
    enabled_connectors: string[];
    assume_mac_local: boolean;
  };
  error?: string;
};

export type ConnectorToolsResponse = {
  ok: boolean;
  provider_key?: string;
  tools?: {
    tool_key: string;
    label: string;
    description: string | null;
    enabled: boolean;
    oauth_visible: boolean;
  }[];
  error?: string;
};

export async function fetchConnectorsCatalog(
  returnTo?: string,
  workspaceId?: string | null,
): Promise<ConnectorsCatalogResponse> {
  const qs = new URLSearchParams();
  if (returnTo?.trim()) qs.set('return_to', returnTo.trim());
  if (workspaceId?.trim()) qs.set('workspace_id', workspaceId.trim());
  const suffix = qs.toString() ? `?${qs}` : '';
  const r = await fetch(`/api/integrations/connectors/catalog${suffix}`, { credentials: 'same-origin' });
  const j = (await r.json()) as ConnectorsCatalogResponse;
  if (!r.ok) return { ...j, ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}

export async function fetchConnectorTools(providerKey: string): Promise<ConnectorToolsResponse> {
  const r = await fetch(
    `/api/integrations/connectors/${encodeURIComponent(providerKey)}/tools`,
    { credentials: 'same-origin' },
  );
  const j = (await r.json()) as ConnectorToolsResponse;
  if (!r.ok) return { ...j, ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}
