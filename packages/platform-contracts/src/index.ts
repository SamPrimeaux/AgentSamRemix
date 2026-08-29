export type ClientSurface =
  | 'mobile_ios'
  | 'mobile_web'
  | 'desktop_web'
  | 'desktop_pwa'
  | 'web_desktop'
  | 'web_mobile'
  | 'pwa_desktop'
  | 'pwa_ios'
  | 'native_ios'
  | 'native_android';

export type ExecutionTarget = 'local' | 'remote' | 'sandbox' | 'customer_host';
export type ExecutionLifecycle = 'durable' | 'ephemeral';
export type ExecutionProtocol = 'pty' | 'ssh' | 'mcp' | 'batch_exec';

export type ClientCapabilities = {
  camera: boolean;
  filesystem: boolean;
  uploads: boolean;
  push_notifications: boolean;
  share: boolean;
  haptics: boolean;
  local_terminal: boolean;
  remote_terminal: boolean;
  sandbox_terminal: boolean;
};

export type ClientEnvironment = {
  surface: ClientSurface;
  capabilities: ClientCapabilities;
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  status: string;
  github_repo: string | null;
  root_path?: string | null;
  database_studio_name?: string | null;
};

export type WorkspaceListResponse = {
  data: WorkspaceSummary[];
  current: string | null;
};

export type SessionUser = {
  id?: string | null;
  user_id?: string | null;
  email?: string | null;
  name?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  active_workspace_id?: string | null;
  [key: string]: unknown;
};

export type AgentSessionSummary = {
  id: string;
  conversation_id?: string;
  title?: string | null;
  name?: string | null;
  workspace_id?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  /** @deprecated Chat sessions no longer stamp github_repo — Files rail / turn envelope only. */
  github_repo?: string | null;
  /** Last model used on the thread (from last_model_key). */
  last_model_key?: string | null;
  /** @deprecated Prefer last_model_key; kept as alias for older clients. */
  model_key?: string | null;
  model_used?: string | null;
  /** Integer unix epoch seconds (normalized at API/client boundary). */
  started_at?: number;
  /** Integer unix epoch seconds (normalized at API/client boundary). */
  updated_at?: number;
  status?: string;
};

export type AgentStreamEvent = Record<string, unknown> & { type?: string };
