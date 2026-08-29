import type React from 'react';

export interface MCP {
  id: string;
  tool_name: string;
  tool_category: string;
  description: string;
  enabled: number;
  requires_approval: number;
  mcp_service_url: string;
  input_schema?: string;
}

export interface AIModel {
  id?: string;
  provider: string;
  model_key: string;
  display_name: string;
  is_active: number;
  supports_tools: number;
  supports_vision: number;
  size_class: string;
  show_in_picker?: number;
  picker_eligible?: number;
  picker_group?: string;
  input_rate_per_mtok?: number | null;
  output_rate_per_mtok?: number | null;
}

export type AgentsamUserPolicy = {
  workspace_id?: string;
  auto_run_mode: string;
  browser_protection: number;
  mcp_tools_protection: number;
  file_deletion_protection: number;
  external_file_protection: number;
  default_agent_location?: string | null;
  text_size?: string | null;
  auto_clear_chat: number;
  submit_with_mod_enter: number;
  max_tab_count: number;
  queue_messages_mode?: string | null;
  usage_summary_mode?: string | null;
  agent_autocomplete: number;
  web_search_enabled: number;
  auto_accept_web_search: number;
  web_fetch_enabled: number;
  hierarchical_ignore: number;
  ignore_symlinks: number;
  inline_diffs: number;
  jump_next_diff_on_accept: number;
  auto_format_on_agent_finish: number;
  legacy_terminal_tool: number;
  toolbar_on_selection: number;
  auto_parse_links: number;
  themed_diff_backgrounds: number;
  terminal_hint: number;
  terminal_preview_box: number;
  collapse_auto_run_commands: number;
  voice_submit_keyword?: string | null;
  commit_attribution: number;
  pr_attribution: number;
  trusted_shell_prefixes_json?: string | null;
  settings_json?: string | null;
};

export type AgentsSettingsResponse = {
  workspace_id: string;
  policy: AgentsamUserPolicy | null;
  /** Full `agentsam_subagent_profile` rows for this workspace (from GET /api/settings/agents). */
  subagents?: Array<Record<string, unknown>>;
  allowlists: {
    commands: string[];
    domains: string[];
    mcp: Array<{ tool_key: string; notes?: string | null; preference?: string | null }>;
  };
  mcp_tool_groups?: Array<{
    group_key: string;
    label: string;
    read_count: number;
    write_count: number;
    tools: Array<{ tool_key: string; label: string; access_class: string }>;
  }>;
  mcp_group_preferences?: Record<string, string>;
};

export type LlmVaultRow = {
  id: string;
  key_name: string;
  masked: string;
  provider?: string;
  created_at?: string | number | null;
};

export type SettingsModelsResponse = {
  models: Array<{
    id: string;
    name: string;
    provider: string;
    is_active: number;
    show_in_picker: number;
    context_window?: number | null;
    cost_per_input_mtok?: number | null;
    cost_per_output_mtok?: number | null;
  }>;
  tiers: Array<Record<string, unknown>>;
  routing: Array<Record<string, unknown>>;
  workspace_id?: string;
};

export type SettingsMcpResponse = {
  // New (Sprint 1): workspace-scoped Tools & MCP view.
  workspace?: { id: string; name: string };
  connected?: { url: string };
  tools: Array<Record<string, unknown>>;

  // Legacy: older MCP settings surface (still returned by API as fallback).
  servers?: Array<Record<string, unknown>>;
  commandPerformance?: Array<Record<string, unknown>>;
};

export interface GitRepo {
  id: number;
  repo_full_name: string;
  repo_url: string;
  default_branch: string;
  cloudflare_worker_name: string;
  is_active: number;
}

export type NavSectionItem = { id: string; icon: React.ReactNode };
