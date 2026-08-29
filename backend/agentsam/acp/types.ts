// AgentSam Agent Client Protocol (ACP) Type Definitions

export interface AcpServerCapabilities {
  protocolVersion: string;
  serverName: string;
  version: string;
  supportedBackends: string[];
  supportedAuthProviders: ('github' | 'github_app' | 'google' | 'google_service_account')[];
  streamingSupported: boolean;
  toolsSupported: string[];
}

export interface AuthStatusResponse {
  authenticated: boolean;
  user: {
    id: string;
    name: string;
    email?: string;
    avatarUrl?: string;
    provider: 'github' | 'google' | 'service_account' | 'anonymous';
    roles?: string[];
  } | null;
  providers: {
    github: {
      configured: boolean;
      clientIdConfigured: boolean;
      clientSecretConfigured: boolean;
      appIdConfigured: boolean;
      appClientIdConfigured: boolean;
      appClientSecretConfigured: boolean;
      connected: boolean;
      username?: string;
      scopes?: string[];
    };
    google: {
      configured: boolean;
      clientIdConfigured: boolean;
      clientSecretConfigured: boolean;
      projectIdConfigured: boolean;
      aiApiKeyConfigured: boolean;
      serviceAccountConfigured: boolean;
      connected: boolean;
      email?: string;
      scopes?: string[];
    };
  };
  envStatus: {
    GITHUB_CLIENT_ID: boolean;
    GITHUB_CLIENT_SECRET: boolean;
    GITHUB_APP_ID: boolean;
    GITHUB_APP_CLIENT_ID: boolean;
    GITHUB_APP_CLIENT_SECRET: boolean;
    GOOGLE_CLIENT_ID: boolean;
    GOOGLE_CLIENT_SECRET: boolean;
    GOOGLE_PROJECT_ID: boolean;
    GOOGLE_AI_API_KEY: boolean;
    GOOGLE_SERVICE_ACCOUNT_JSON: boolean;
    GEMINI_API_KEY: boolean;
  };
}

export interface AcpSession {
  id: string;
  title: string;
  backend: 'antigravity' | 'cloudflare' | 'local_pty' | 'gcp_vm';
  createdAt: string;
  updatedAt: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  stepCount: number;
  currentStep?: number;
  totalTokens: {
    input: number;
    output: number;
    thinking: number;
  };
  totalCostUsd: number;
  environmentVariables: Record<string, string>;
  workingDirectory: string;
}

export interface AcpRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface AcpRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface AcpToolExecutionRequest {
  tool: 'terminal' | 'file_diff' | 'ast_audit' | 'network_probe' | 'gemini_eval';
  parameters: {
    command?: string;
    cwd?: string;
    filePath?: string;
    code?: string;
    url?: string;
    prompt?: string;
    backend?: string;
  };
}

export interface AcpToolExecutionResult {
  tool: string;
  success: boolean;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs: number;
  data?: unknown;
  timestamp: string;
}
