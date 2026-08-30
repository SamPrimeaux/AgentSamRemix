/** CMS-owned site/project DTOs. Workspace identity belongs to the application WorkspaceContext. */
export type CmsSiteSummary = {
  slug: string;
  name?: string;
  domain?: string | null;
  logo_url?: string | null;
  primary_color?: string | null;
  page_count?: number;
  source?: string;
  target_workspace_id?: string | null;
  is_featured?: boolean;
  hub_priority?: number;
  cms_hosting?: 'platform' | 'client_worker' | null;
  updated_at?: string | number | null;
};

export type CmsSiteContext = {
  workspace_id: string | null;
  workspace_name: string | null;
  workspace_slug: string | null;
  ui_label: string | null;
  project_slug: string | null;
  project_name: string | null;
  resolved_from: string | null;
  bootstrap_cache_key: string | null;
  bootstrap_id: string | null;
  sites: CmsSiteSummary[];
  cms_hosting?: 'platform' | 'client_worker';
  api_profile?: string | null;
  studio_url?: string | null;
  bridge_supported?: boolean;
  worker_base_url?: string | null;
  public_domain?: string | null;
  r2_bucket?: string | null;
  d1_database_id?: string | null;
  agent_site_context?: Record<string, unknown> | null;
  is_operator_hub?: boolean;
  error?: string | null;
};
