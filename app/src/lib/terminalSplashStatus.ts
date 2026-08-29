import type { TerminalTargetsPayload } from '../../components/LocalTerminalSetup';

export type SplashLaneTone = 'ok' | 'warn' | 'muted' | 'loading';

export type SplashStatusLane = {
  label: string;
  value: string;
  tone: SplashLaneTone;
  detail?: string;
  name?: string | null;
  cwd?: string | null;
};

export type TerminalSplashStatus = {
  workspace: SplashStatusLane;
  runtime: SplashStatusLane;
  tunnel: SplashStatusLane;
  agent: SplashStatusLane;
  /** Always null — dock selection is SSOT; kept for type compat. */
  preferredLane: null;
  selectedLane: 'local' | 'cloud' | 'sandbox' | null;
  selectedTargetType: 'user_hosted_tunnel' | 'platform_vm' | 'sandbox' | null;
  targets: TerminalTargetsPayload | null;
  workspaceMeta: {
    id: string;
    name: string | null;
    cwd: string | null;
    cd_command: string | null;
  } | null;
};

export type TerminalSplashStatusResponse = {
  ok?: boolean;
  fetched_at?: number;
  workspace_id?: string;
  workspace?: {
    id?: string;
    name?: string | null;
    slug?: string | null;
    github_repo?: string | null;
    is_active_context?: boolean;
    cwd?: string | null;
    cd_command?: string | null;
  };
  targets?: TerminalTargetsPayload;
  preferred_lane?: null;
  selected_lane?: 'local' | 'cloud' | 'sandbox' | null;
  selected_target_type?: 'user_hosted_tunnel' | 'platform_vm' | 'sandbox' | null;
  lanes?: {
    workspace?: SplashStatusLane & { name?: string | null; cwd?: string | null };
    runtime?: SplashStatusLane;
    tunnel?: SplashStatusLane;
    agent?: SplashStatusLane;
  };
};

function wsHeaders(workspaceId: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  if (workspaceId) h['X-IAM-Workspace-Id'] = workspaceId;
  return h;
}

const EMPTY: TerminalSplashStatus = {
  workspace: { label: 'Workspace', value: '—', tone: 'muted' },
  runtime: { label: 'Runtime', value: '—', tone: 'muted' },
  tunnel: { label: 'Tunnel', value: '—', tone: 'muted' },
  agent: { label: 'Agent', value: '—', tone: 'muted' },
  preferredLane: null,
  selectedLane: null,
  selectedTargetType: null,
  targets: null,
  workspaceMeta: null,
};

function mapResponse(body: TerminalSplashStatusResponse): TerminalSplashStatus {
  const lanes = body.lanes;
  const wsLane = lanes?.workspace;
  const wsMeta = body.workspace;
  return {
    workspace: wsLane
      ? {
          label: wsLane.label || 'Workspace',
          value: wsLane.value || wsMeta?.name || '—',
          tone: (wsLane.tone as SplashLaneTone) || 'muted',
          name: wsLane.name ?? wsMeta?.name ?? null,
          cwd: wsLane.cwd ?? wsMeta?.cwd ?? null,
          detail: wsMeta?.github_repo ?? undefined,
        }
      : EMPTY.workspace,
    runtime: lanes?.runtime
      ? {
          label: lanes.runtime.label || 'Runtime',
          value: lanes.runtime.value || '—',
          tone: (lanes.runtime.tone as SplashLaneTone) || 'muted',
        }
      : EMPTY.runtime,
    tunnel: lanes?.tunnel
      ? {
          label: lanes.tunnel.label || 'Tunnel',
          value: lanes.tunnel.value || '—',
          tone: (lanes.tunnel.tone as SplashLaneTone) || 'muted',
        }
      : EMPTY.tunnel,
    agent: lanes?.agent
      ? {
          label: lanes.agent.label || 'Agent',
          value: lanes.agent.value || '—',
          tone: (lanes.agent.tone as SplashLaneTone) || 'muted',
        }
      : EMPTY.agent,
    preferredLane: null,
    selectedLane: body.selected_lane ?? null,
    selectedTargetType: body.selected_target_type ?? null,
    targets: body.targets ?? null,
    workspaceMeta: wsMeta?.id
      ? {
          id: String(wsMeta.id),
          name: wsMeta.name ?? null,
          cwd: wsMeta.cwd ?? null,
          cd_command: wsMeta.cd_command ?? null,
        }
      : null,
  };
}

export async function fetchTerminalSplashStatus(
  workspaceId: string | null | undefined,
  _workspaceLabel = '',
  opts?: { targetType?: string | null },
): Promise<TerminalSplashStatus> {
  const wid = workspaceId?.trim() || '';
  if (!wid) return { ...EMPTY, workspace: { ...EMPTY.workspace, value: 'select workspace' } };

  try {
    const qs = new URLSearchParams({ workspace_id: wid });
    const tt = String(opts?.targetType || '').trim();
    if (tt) qs.set('target_type', tt);
    const r = await fetch(`/api/terminal/splash-status?${qs}`, {
      credentials: 'same-origin',
      headers: wsHeaders(wid),
    });
    if (!r.ok) return EMPTY;
    const body = (await r.json().catch(() => null)) as TerminalSplashStatusResponse | null;
    if (!body?.ok) return EMPTY;
    return mapResponse(body);
  } catch {
    return EMPTY;
  }
}
