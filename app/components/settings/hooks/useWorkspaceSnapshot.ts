import { useCallback, useEffect, useState } from 'react';
import { catalogSlugForRegistry } from '../../../lib/integrationSlugAliases';
import { useWorkspace } from '../../../src/context/WorkspaceContext';

export type OpSettings = {
  cf_account_id?: string;
  cf_d1_database_id?: string;
  cf_d1_database_name?: string;
  cf_worker_name?: string;
  cf_tunnel_id?: string;
  cf_tunnel_name?: string;
  cf_stack_configured_at?: number;
  github_repo?: string;
  workspace_root?: string;
  deploy_command?: string;
  deploy_stack_command?: string;
  deploy_worker_command?: string;
  build_command?: string;
};

function mergeAccountCfStack(
  workspaceOp: OpSettings,
  accountStack: OpSettings,
  ctx?: { stack_configured?: boolean; account_id?: string | null },
): OpSettings {
  const accountReady =
    Boolean(accountStack.cf_stack_configured_at) ||
    Boolean(accountStack.cf_d1_database_id || accountStack.cf_worker_name) ||
    Boolean(ctx?.stack_configured) ||
    Boolean(ctx?.account_id || accountStack.cf_account_id);
  if (!accountReady) return workspaceOp;
  return {
    ...workspaceOp,
    cf_account_id: accountStack.cf_account_id || ctx?.account_id || workspaceOp.cf_account_id,
    cf_d1_database_id: accountStack.cf_d1_database_id || workspaceOp.cf_d1_database_id,
    cf_d1_database_name: accountStack.cf_d1_database_name || workspaceOp.cf_d1_database_name,
    cf_worker_name: accountStack.cf_worker_name || workspaceOp.cf_worker_name,
    cf_tunnel_id: accountStack.cf_tunnel_id || workspaceOp.cf_tunnel_id,
    cf_tunnel_name: accountStack.cf_tunnel_name || workspaceOp.cf_tunnel_name,
    cf_stack_configured_at:
      accountStack.cf_stack_configured_at ||
      (ctx?.stack_configured ? Date.now() : undefined) ||
      workspaceOp.cf_stack_configured_at,
  };
}

export type GitStatus = {
  status?: string;
  branch?: string | null;
  repo?: string | null;
  repo_full_name?: string | null;
  checkpoint_sha?: string | null;
  ahead_by?: number | null;
  behind_by?: number | null;
};

export type KeyRow = {
  id: string;
  label?: string | null;
  provider?: string | null;
  secret_name?: string | null;
  status?: string | null;
  last_four?: string | null;
  updated_at?: string | number | null;
};

export type ConnectedItem = {
  connection?: { provider_key?: string; status?: string; account_display?: string | null };
  catalog?: { name?: string; slug?: string; icon_slug?: string };
  integration_status?: { connected?: boolean; error?: string };
};

export type WorkspaceSnapshot = {
  workspace: Record<string, unknown> | null;
  opSettings: OpSettings;
  connected: ConnectedItem[];
  git: GitStatus | null;
  health: { overall?: string; services?: Array<{ service?: string; status?: string }> } | null;
  keys: KeyRow[];
  lastDeploy: { at?: string | number | null; version?: string | null; git_sha?: string | null; status?: string | null };
  activity: Array<{ action?: string; created_at?: number | string; actor_email?: string | null }>;
  members: Array<Record<string, unknown>>;
  codeIndex: {
    chunkJob?: Record<string, unknown> | null;
    ast?: Record<string, unknown> | null;
    embedCost?: Record<string, unknown> | null;
    notes?: Record<string, string> | null;
  } | null;
};

const EMPTY: WorkspaceSnapshot = {
  workspace: null,
  opSettings: {},
  connected: [],
  git: null,
  health: null,
  keys: [],
  lastDeploy: {},
  activity: [],
  members: [],
  codeIndex: null,
};

async function fetchJson<T>(url: string, workspaceId?: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      credentials: 'same-origin',
      headers: workspaceId ? { 'X-IAM-Workspace-Id': workspaceId } : undefined,
    });
    const j = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return null;
    return j as T;
  } catch {
    return null;
  }
}

function parseOpSettings(raw: unknown): OpSettings {
  if (!raw || typeof raw !== 'object') return {};
  return raw as OpSettings;
}

export function useWorkspaceSnapshot(workspaceId?: string | null) {
  const { loading: workspaceLoading, loadError: workspaceLoadError, refreshWorkspaces } =
    useWorkspace();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(EMPTY);
  const [healthChecking, setHealthChecking] = useState(false);

  const ws = workspaceId?.trim() || '';
  const qp = ws ? `?workspace_id=${encodeURIComponent(ws)}` : '';

  const load = useCallback(async () => {
    if (!ws) {
      setSnapshot(EMPTY);
      // Don't lie: bootstrap still in flight ≠ empty account.
      if (workspaceLoading) {
        setLoading(true);
        setError(null);
        return;
      }
      if (workspaceLoadError) {
        setLoading(false);
        setError(workspaceLoadError);
        return;
      }
      setLoading(false);
      setError('No active workspace — pick one from the status bar, or retry if you just connected.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [
        settingsRes,
        opRes,
        cfCtxRes,
        connectedRes,
        gitRes,
        healthRes,
        keysRes,
        cicdRes,
        auditRes,
        membersRes,
        codeIndexRes,
      ] = await Promise.all([
        fetchJson<{ workspace?: Record<string, unknown> }>(`/api/settings/workspace${qp}`, ws),
        fetchJson<{ settings_json?: OpSettings }>(`/api/workspace/settings${qp}`, ws),
        fetchJson<{
          stack?: OpSettings;
          settings_json?: OpSettings;
          stack_configured?: boolean;
          account_id?: string | null;
        }>('/api/integrations/cloudflare/context'),
        fetchJson<{ items?: ConnectedItem[] }>('/api/settings/integrations/connected'),
        fetchJson<GitStatus>(`/api/agent/git/status${qp}`, ws),
        fetchJson<{ overall?: string; services?: Array<{ service?: string; status?: string }> }>(
          `/api/workspaces/${encodeURIComponent(ws)}/health`,
          ws,
        ),
        fetchJson<{ items?: KeyRow[] }>(`/api/settings/keys${qp}`, ws),
        fetchJson<{
          extra?: {
            dashboard_versions?: Array<{ deployed_at?: string; version?: string; git_sha?: string }>;
            cicd_pipeline_runs?: Array<{ completed_at?: string; status?: string; commit_hash?: string }>;
          };
        }>('/api/settings/cicd'),
        fetchJson<{ events?: Array<{ action?: string; created_at?: number; actor_email?: string }> }>(
          `/api/workspaces/${encodeURIComponent(ws)}/audit`,
          ws,
        ),
        fetchJson<{ members?: Array<Record<string, unknown>> }>(
          `/api/settings/workspace/members${qp}`,
          ws,
        ),
        fetchJson<{
          last_deploy?: {
            at?: string | number | null;
            version?: string | null;
            git_sha?: string | null;
            status?: string | null;
          } | null;
          chunk_index?: { job?: Record<string, unknown> | null };
          ast?: Record<string, unknown>;
          notes?: Record<string, string>;
        }>(`/api/settings/workspace/code-index-status${qp}`, ws),
      ]);

      const dv = cicdRes?.extra?.dashboard_versions?.[0];
      const run = cicdRes?.extra?.cicd_pipeline_runs?.[0];
      const fromD1 = codeIndexRes?.last_deploy;
      const accountStack = parseOpSettings(cfCtxRes?.stack || cfCtxRes?.settings_json);

      setSnapshot({
        workspace: settingsRes?.workspace ?? null,
        opSettings: mergeAccountCfStack(parseOpSettings(opRes?.settings_json), accountStack, {
          stack_configured: cfCtxRes?.stack_configured,
          account_id: cfCtxRes?.account_id,
        }),
        connected: connectedRes?.items ?? [],
        git: gitRes,
        health: healthRes,
        keys: keysRes?.items ?? [],
        lastDeploy: {
          at: fromD1?.at ?? dv?.deployed_at ?? run?.completed_at ?? null,
          version: fromD1?.version ?? dv?.version ?? null,
          git_sha: fromD1?.git_sha ?? dv?.git_sha ?? run?.commit_hash ?? null,
          status: fromD1?.status ?? run?.status ?? (fromD1 ? 'success' : null),
        },
        activity: auditRes?.events ?? [],
        members: membersRes?.members ?? [],
        codeIndex: codeIndexRes
          ? {
              chunkJob: codeIndexRes.chunk_index?.job ?? null,
              ast: codeIndexRes.ast ?? null,
              embedCost: (codeIndexRes as { embed_cost?: Record<string, unknown> }).embed_cost ?? null,
              notes: codeIndexRes.notes ?? null,
            }
          : null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace');
      setSnapshot(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [qp, ws, workspaceLoading, workspaceLoadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const runHealthCheck = useCallback(async () => {
    if (!ws) return;
    setHealthChecking(true);
    try {
      const healthRes = await fetchJson<{ overall?: string; services?: Array<{ service?: string; status?: string }> }>(
        `/api/workspaces/${encodeURIComponent(ws)}/health`,
      );
      if (healthRes) {
        setSnapshot((s) => ({ ...s, health: healthRes }));
      }
    } finally {
      setHealthChecking(false);
    }
  }, [ws]);

  const reload = useCallback(async () => {
    if (!ws) {
      await refreshWorkspaces({ force: true });
      return;
    }
    await load();
  }, [ws, refreshWorkspaces, load]);

  return { loading, error, snapshot, reload, runHealthCheck, healthChecking };
}

export function isIntegrationConnected(items: ConnectedItem[], registryKey: string): boolean {
  const key = registryKey.toLowerCase();
  const item = items.find(
    (i) => String(i.connection?.provider_key || '').toLowerCase() === key,
  );
  if (!item) return false;
  const st = String(item.connection?.status || '').toLowerCase();
  return st === 'connected' || item.integration_status?.connected === true;
}

export function connectedSubtitle(item: ConnectedItem | undefined): string {
  if (!item) return 'Not connected';
  const st = String(item.connection?.status || '').toLowerCase();
  if (st === 'connected' || item.integration_status?.connected) {
    return item.connection?.account_display || 'Connected';
  }
  if (st === 'degraded' || item.integration_status?.error) return 'Needs attention';
  return 'Not connected';
}

export type ServiceTileDef = {
  id: string;
  title: string;
  iconSlug: string;
  registryKey: string;
  settingsPath: string;
};

export const PROJECT_SERVICE_TILES: ServiceTileDef[] = [
  { id: 'github', title: 'GitHub', iconSlug: 'github', registryKey: 'github', settingsPath: '/dashboard/settings/integrations' },
  { id: 'cloudflare', title: 'Cloudflare', iconSlug: 'cloudflare', registryKey: 'cloudflare_oauth', settingsPath: '/dashboard/settings/integrations' },
  { id: 'supabase', title: 'Supabase', iconSlug: 'supabase', registryKey: 'supabase_oauth', settingsPath: '/dashboard/settings/integrations' },
  { id: 'openai', title: 'OpenAI', iconSlug: 'openai_api', registryKey: 'openai', settingsPath: '/dashboard/settings/keys' },
  { id: 'google_drive', title: 'Google Drive', iconSlug: 'google_workspace', registryKey: 'google_drive', settingsPath: '/dashboard/settings/integrations' },
  { id: 'resend', title: 'Resend', iconSlug: 'resend', registryKey: 'resend', settingsPath: '/dashboard/settings/keys' },
  { id: 'cloudflare_r2', title: 'R2', iconSlug: 'cf_r2', registryKey: 'cloudflare_r2', settingsPath: '/dashboard/settings/storage' },
  { id: 'local_tunnel', title: 'Local Machine', iconSlug: 'cf_workers', registryKey: 'local_tunnel', settingsPath: '/dashboard/settings/integrations' },
];

export function findConnectedItem(items: ConnectedItem[], registryKey: string): ConnectedItem | undefined {
  return items.find(
    (i) => String(i.connection?.provider_key || '').toLowerCase() === registryKey.toLowerCase(),
  );
}

export function tileIconSlug(def: ServiceTileDef, item?: ConnectedItem): string {
  return item?.catalog?.icon_slug || catalogSlugForRegistry(def.registryKey) || def.iconSlug;
}
