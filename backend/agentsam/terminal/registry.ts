import type { Env } from '../../src/env';

export type ExecLane = 'local' | 'remote' | 'sandbox' | 'environment';

export type TerminalConnection = {
  id: string;
  user_id: string | null;
  workspace_id: string;
  tenant_id: string;
  name: string;
  target_type: string;
  ws_url: string;
  platform: 'linux' | 'macos' | 'windows' | string;
  shell: string | null;
  is_default: number;
  target_priority: number;
  cwd_strategy: string;
  remote_exec_user: string | null;
  username: string | null;
  privileged_target_id: string | null;
  metadata_json: string | null;
};

export const BUILTIN_VPC_CONNECTION_ID = 'builtin:pty-service';

export const LANE_TARGET_TYPE: Record<ExecLane, string> = {
  local: 'user_hosted_tunnel',
  remote: 'platform_vm',
  sandbox: 'sandbox',
  environment: 'ephemeral_vm',
};

export function isExecLane(value: unknown): value is ExecLane {
  return value === 'local' || value === 'remote' || value === 'sandbox' || value === 'environment';
}

function trim(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

export function defaultCwdForConnection(connection: TerminalConnection): string {
  if (connection.target_type === 'sandbox' || connection.target_type === 'ephemeral_vm') return '/workspace';
  const execUser = trim(connection.remote_exec_user || connection.username);
  if (!execUser) return connection.platform === 'macos' ? '/Users' : '/home';
  if (connection.platform === 'macos') return `/Users/${execUser}`;
  if (connection.platform === 'windows') return 'C:\\';
  return execUser === 'root' ? '/root' : `/home/${execUser}`;
}

export function builtinVpcConnection(
  env: Env,
  input: { userId: string; workspaceId: string },
): TerminalConnection | null {
  if (!env.PTY_SERVICE?.fetch) return null;
  const userId = trim(input.userId);
  const workspaceId = trim(input.workspaceId);
  if (!userId || !workspaceId) return null;
  return {
    id: BUILTIN_VPC_CONNECTION_ID,
    user_id: userId,
    workspace_id: workspaceId,
    tenant_id: '',
    name: 'AgentSam VPC',
    target_type: 'platform_vm',
    ws_url: '',
    platform: 'linux',
    shell: '/bin/bash',
    is_default: 1,
    target_priority: 0,
    cwd_strategy: 'host_default',
    remote_exec_user: null,
    username: null,
    privileged_target_id: null,
    metadata_json: JSON.stringify({ source: 'binding', binding: 'PTY_SERVICE' }),
  };
}

export async function resolveTerminalConnection(
  env: Env,
  input: {
    userId: string;
    workspaceId: string;
    lane: ExecLane;
    connectionId?: string | null;
  },
): Promise<TerminalConnection | null> {
  const userId = trim(input.userId);
  const workspaceId = trim(input.workspaceId);
  if (!userId || !workspaceId) return null;

  const targetType = LANE_TARGET_TYPE[input.lane];
  const explicitId = trim(input.connectionId);
  const builtin = input.lane === 'remote'
    ? builtinVpcConnection(env, { userId, workspaceId })
    : null;

  if (explicitId === BUILTIN_VPC_CONNECTION_ID) return builtin;

  try {
    if (explicitId) {
      return await env.DB.prepare(`
        SELECT id,user_id,workspace_id,tenant_id,name,target_type,ws_url,platform,shell,
               is_default,target_priority,cwd_strategy,remote_exec_user,username,
               privileged_target_id,metadata_json
        FROM terminal_connections
        WHERE id = ? AND user_id = ? AND workspace_id = ? AND target_type = ? AND is_active = 1
        LIMIT 1
      `).bind(explicitId, userId, workspaceId, targetType).first<TerminalConnection>();
    }

    const registered = await env.DB.prepare(`
      SELECT id,user_id,workspace_id,tenant_id,name,target_type,ws_url,platform,shell,
             is_default,target_priority,cwd_strategy,remote_exec_user,username,
             privileged_target_id,metadata_json
      FROM terminal_connections
      WHERE user_id = ? AND workspace_id = ? AND target_type = ? AND is_active = 1
      ORDER BY is_default DESC, target_priority ASC, updated_at DESC
      LIMIT 1
    `).bind(userId, workspaceId, targetType).first<TerminalConnection>();
    if (registered) return registered;
  } catch (error) {
    // A built-in Cloudflare binding must remain usable while old connection
    // registry tables are absent or being migrated. Explicit IDs still fail
    // closed below rather than silently switching machines.
    if (explicitId) return null;
    console.warn('[terminal] connection registry unavailable', error);
  }

  return explicitId ? null : builtin;
}

export async function resolveUserRuntimeScope(env: Env, userId: string) {
  const id = trim(userId);
  if (!id) return null;
  const row = await env.DB.prepare(`
    SELECT id, tenant_id, active_tenant_id, active_workspace_id, default_workspace_id
    FROM auth_users
    WHERE id = ? AND status = 'active'
    LIMIT 1
  `).bind(id).first<{
    id: string;
    tenant_id: string | null;
    active_tenant_id: string | null;
    active_workspace_id: string | null;
    default_workspace_id: string | null;
  }>();
  if (!row) return null;
  const workspaceId = trim(row.active_workspace_id || row.default_workspace_id);
  if (!workspaceId) return null;
  return {
    userId: row.id,
    tenantId: trim(row.active_tenant_id || row.tenant_id) || null,
    workspaceId,
  };
}

export function publicConnection(connection: TerminalConnection | null) {
  if (!connection) return null;
  return {
    id: connection.id,
    name: connection.name,
    targetType: connection.target_type,
    platform: connection.platform,
    shell: connection.shell,
    defaultCwd: defaultCwdForConnection(connection),
  };
}
