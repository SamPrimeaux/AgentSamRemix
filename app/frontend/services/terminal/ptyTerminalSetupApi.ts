export type PtyTokenStatus = {
  ok?: boolean;
  has_token?: boolean;
  last4?: string | null;
  connection_active?: boolean;
};

export type PtyTunnelStatus = {
  ok?: boolean;
  tunnel_id?: string | null;
  tunnel_name?: string | null;
  hostname?: string | null;
  zone_id?: string | null;
  cf_status?: string;
  connection_active?: boolean;
  connections_count?: number;
  has_run_token?: boolean;
  run_token?: string | null;
};

export type PtyLocalConn = {
  has_local?: boolean;
  connection?: {
    id?: string;
    ws_url_present?: boolean;
    is_active?: boolean;
    platform?: string;
    shell?: string;
  };
};

export type HostedTunnelConnection = {
  id: string;
  name: string;
  platform?: string | null;
  shell?: string | null;
  is_active: boolean;
  is_default: boolean;
  ws_url_present: boolean;
  hostname?: string | null;
  updated_at?: number | null;
};

export type CfZone = { id: string; name: string; status?: string };

export type PtyDefaults = {
  zone_id?: string | null;
  hostname?: string | null;
  tunnel_name?: string | null;
};

function wsHeaders(workspaceId: string | null): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (workspaceId) h['X-IAM-Workspace-Id'] = workspaceId;
  return h;
}

async function readErr(r: Response, j: Record<string, unknown>) {
  const msg = j.message ?? j.error;
  if (typeof msg === 'string' && msg.trim()) return msg.trim();
  return `Request failed (${r.status})`;
}

export async function fetchPtyStatus(workspaceId: string) {
  const hdr = wsHeaders(workspaceId);
  const [tRes, tunRes, locRes] = await Promise.all([
    fetch('/api/terminal/token/status', { credentials: 'same-origin', headers: hdr }),
    fetch('/api/terminal/tunnel/status', { credentials: 'same-origin', headers: hdr }),
    fetch('/api/terminal/connections/local', { credentials: 'same-origin', headers: hdr }),
  ]);
  const tJ = (await tRes.json().catch(() => ({}))) as PtyTokenStatus & Record<string, unknown>;
  const tunJ = (await tunRes.json().catch(() => ({}))) as PtyTunnelStatus & Record<string, unknown>;
  const locJ = (await locRes.json().catch(() => ({}))) as PtyLocalConn;
  const tunnel = tunRes.ok ? tunJ : null;
  return {
    token: tRes.ok ? tJ : null,
    tunnel,
    local: locRes.ok ? locJ : null,
    tokenError: tRes.ok ? null : await readErr(tRes, tJ as Record<string, unknown>),
  };
}

export async function fetchPtyDefaults(workspaceId: string): Promise<PtyDefaults | null> {
  const r = await fetch('/api/settings/keys/hints', {
    credentials: 'same-origin',
    headers: wsHeaders(workspaceId),
  });
  if (!r.ok) return null;
  const j = (await r.json().catch(() => ({}))) as { pty_defaults?: PtyDefaults };
  return j.pty_defaults ?? null;
}

export async function fetchCfZones(workspaceId: string): Promise<CfZone[]> {
  const r = await fetch('/api/settings/keys/cloudflare/zones', {
    credentials: 'same-origin',
    headers: wsHeaders(workspaceId),
  });
  const j = (await r.json().catch(() => ({}))) as { zones?: CfZone[]; message?: string; error?: string };
  if (!r.ok) {
    throw new Error(
      typeof j.message === 'string'
        ? j.message
        : typeof j.error === 'string'
          ? j.error
          : `Zones list failed (${r.status})`,
    );
  }
  return Array.isArray(j.zones) ? j.zones.filter((z) => z?.id) : [];
}

export async function hasCloudflareProviderKey(workspaceId: string): Promise<boolean> {
  const r = await fetch('/api/settings/keys', {
    credentials: 'same-origin',
    headers: wsHeaders(workspaceId),
  });
  if (!r.ok) return false;
  const j = (await r.json().catch(() => ({}))) as { items?: { provider?: string; status?: string }[] };
  const items = Array.isArray(j.items) ? j.items : [];
  return items.some(
    (row) =>
      String(row.provider || '').toLowerCase() === 'cloudflare' &&
      String(row.status || 'active').toLowerCase() !== 'revoked',
  );
}

/** BYOK API key or connected Cloudflare OAuth — enough to provision a local tunnel. */
export async function hasCloudflareTerminalAccess(workspaceId: string): Promise<boolean> {
  if (await hasCloudflareProviderKey(workspaceId)) return true;
  const ws = workspaceId.trim();
  if (!ws) return false;
  try {
    const qs = new URLSearchParams({ workspace_id: ws });
    const r = await fetch(`/api/settings/integrations/connected?${qs}`, { credentials: 'same-origin' });
    if (!r.ok) return false;
    const j = (await r.json().catch(() => ({}))) as {
      connected?: { provider_key?: string; status?: string }[];
    };
    const rows = Array.isArray(j.connected) ? j.connected : [];
    return rows.some(
      (row) =>
        String(row.provider_key || '').toLowerCase() === 'cloudflare_oauth' &&
        String(row.status || '').toLowerCase() === 'connected',
    );
  } catch {
    return false;
  }
}

export function cloudflareOAuthStartUrl(returnTo?: string): string {
  const path =
    typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : '/dashboard/agent';
  const rt = encodeURIComponent(returnTo?.trim() || path);
  return `/api/oauth/cloudflare/start?return_to=${rt}`;
}

export async function generatePtyToken(workspaceId: string): Promise<string> {
  const r = await fetch('/api/terminal/token/generate', {
    method: 'POST',
    credentials: 'same-origin',
    headers: wsHeaders(workspaceId),
    body: JSON.stringify({}),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(await readErr(r, j));
  return typeof j.token === 'string' ? j.token : '';
}

export async function fetchHostedTunnelConnections(workspaceId: string): Promise<HostedTunnelConnection[]> {
  const qs = new URLSearchParams({ workspace_id: workspaceId.trim() });
  const r = await fetch(`/api/terminal/connections/hosted?${qs}`, {
    credentials: 'same-origin',
    headers: wsHeaders(workspaceId),
  });
  const j = (await r.json().catch(() => ({}))) as { connections?: HostedTunnelConnection[] };
  if (!r.ok) return [];
  return Array.isArray(j.connections) ? j.connections : [];
}

export async function createHostedTunnelConnection(
  workspaceId: string,
  input: { name: string; platform?: string; shell?: string },
): Promise<HostedTunnelConnection | null> {
  const r = await fetch('/api/terminal/connections/hosted', {
    method: 'POST',
    credentials: 'same-origin',
    headers: wsHeaders(workspaceId),
    body: JSON.stringify(input),
  });
  const j = (await r.json().catch(() => ({}))) as { connection?: HostedTunnelConnection; error?: string };
  if (!r.ok) throw new Error(j.error || `Create failed (${r.status})`);
  return j.connection ?? null;
}

export async function setDefaultHostedTunnelConnection(
  workspaceId: string,
  connectionId: string,
): Promise<void> {
  const r = await fetch('/api/terminal/connections/hosted/default', {
    method: 'POST',
    credentials: 'same-origin',
    headers: wsHeaders(workspaceId),
    body: JSON.stringify({ connection_id: connectionId }),
  });
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(j.error || `Default pin failed (${r.status})`);
}

export async function provisionPtyTunnel(
  workspaceId: string,
  input: {
    tunnel_name: string;
    hostname: string;
    zone_id: string;
    platform: string;
    shell: string;
    connection_id?: string;
    connection_name?: string;
  },
): Promise<{ run_token?: string; hostname?: string; ws_url?: string; connection_id?: string }> {
  const r = await fetch('/api/terminal/tunnel/provision', {
    method: 'POST',
    credentials: 'same-origin',
    headers: wsHeaders(workspaceId),
    body: JSON.stringify({ ...input, port: 3099 }),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(await readErr(r, j));
  return {
    run_token: typeof j.run_token === 'string' ? j.run_token : undefined,
    hostname: typeof j.hostname === 'string' ? j.hostname : input.hostname,
    ws_url: typeof j.ws_url === 'string' ? j.ws_url : undefined,
    connection_id: typeof j.connection_id === 'string' ? j.connection_id : undefined,
  };
}

export function buildIamPtyEnvBlock(input: {
  sessionUserId: string;
  workspaceId: string;
  ptyToken: string;
  hostname: string;
  runToken: string;
  workerOrigin: string;
}): string {
  const tunnel = input.hostname.replace(/^https?:\/\//, '');
  return `# ExecOS .env
PTY_AUTH_TOKEN=${input.ptyToken}
PTY_PORT=3099
WORKSPACES_ROOT=C:\\Users\\authUserId\\workspace 
WORKER_URL=${input.workerOrigin}
TUNNEL_URL=https://${tunnel}
IAM_PTY_USER_ID=${input.sessionUserId}
IAM_PTY_WORKSPACE_ID=${input.workspaceId}

# Terminal 1 — cloudflared
cloudflared tunnel run --token ${input.runToken}

# Terminal 2 — PTY server (Windows PowerShell example)
cd ExecOS; npm install; node server.js`;
}
