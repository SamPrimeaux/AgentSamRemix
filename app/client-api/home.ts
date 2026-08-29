export type DashboardHomeTile = {
  id: string;
  tile_key: string;
  title: string;
  cta_label: string;
  path: string;
  image_url: string | null;
  tile_size?: 'sm' | 'md' | 'lg';
  /** Artwork scale within icon shell (0.5–1.2). */
  icon_scale?: number;
  /** Optional hex/rgb background behind artwork. */
  icon_bg?: string | null;
  sort_order: number;
  is_enabled: boolean;
};

export type DashboardHomeResponse = {
  ok: boolean;
  workspace_id?: string;
  tiles?: DashboardHomeTile[];
  editable?: boolean;
  error?: string;
};

function qs(workspaceId?: string | null) {
  if (!workspaceId?.trim()) return '';
  return `?workspace_id=${encodeURIComponent(workspaceId.trim())}`;
}

export async function fetchDashboardHomeTiles(workspaceId?: string | null): Promise<DashboardHomeResponse> {
  const r = await fetch(`/api/dashboard/home${qs(workspaceId)}`, { credentials: 'same-origin' });
  const j = (await r.json()) as DashboardHomeResponse;
  if (!r.ok) return { ...j, ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}

export async function saveDashboardHomeTiles(
  workspaceId: string,
  tiles: DashboardHomeTile[],
): Promise<DashboardHomeResponse> {
  const r = await fetch('/api/dashboard/home', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: workspaceId, tiles }),
  });
  const j = (await r.json()) as DashboardHomeResponse;
  if (!r.ok) return { ...j, ok: false, error: j.error || `HTTP ${r.status}` };
  return j;
}
