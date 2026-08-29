export type ConnectTile = {
  id: string;
  provider_key: string;
  connect_slug: string;
  catalog_slug: string;
  title: string;
  icon_slug: string;
  icon_url: string | null;
  custom_icon_url?: string | null;
  icon_scale?: number;
  icon_bg?: string | null;
  category: string;
  auth_type?: string;
  status: string;
  connected: boolean;
  issue?: 'warning' | 'error' | null;
  account_display?: string | null;
  sort_order: number;
  connect_url: string | null;
  settings_path: string;
  show_on_home?: boolean;
  show_on_workspace?: boolean;
  description?: string | null;
};

export type ConnectCatalogOption = ConnectTile & {
  connectable?: boolean;
  api_key_label?: string | null;
};

export type ConnectTilesResponse = {
  ok: boolean;
  surface?: string;
  tiles?: ConnectTile[];
  catalog_available?: ConnectCatalogOption[];
  connected_slugs?: string[];
  error?: string;
  updated_at?: string;
};

export async function fetchConnectTiles(
  surface: 'home' | 'workspace' = 'home',
): Promise<ConnectTilesResponse> {
  const qs = `?surface=${encodeURIComponent(surface)}`;
  const r = await fetch(`/api/dashboard/home/connect-tiles${qs}`, { credentials: 'same-origin' });
  const j = (await r.json()) as ConnectTilesResponse;
  if (!r.ok) return { ...j, ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}

export type ConnectTileSavePayload = Pick<
  ConnectTile,
  'provider_key' | 'sort_order' | 'show_on_home' | 'show_on_workspace' | 'icon_scale' | 'icon_bg' | 'custom_icon_url'
>;

export async function saveConnectTiles(
  surface: 'home' | 'workspace',
  tiles: ConnectTileSavePayload[],
): Promise<ConnectTilesResponse> {
  const r = await fetch(`/api/dashboard/home/connect-tiles?surface=${encodeURIComponent(surface)}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tiles }),
  });
  const j = (await r.json()) as ConnectTilesResponse;
  if (!r.ok) return { ...j, ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}
