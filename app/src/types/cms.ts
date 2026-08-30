/**
 * Canonical CMS contracts — shared by dashboard, Worker API, preview, and publish.
 * New CMS logic should import from here; do not duplicate shapes in loose JS.
 */

/** Page lifecycle in D1 */
export type CmsPageStatus = 'draft' | 'published' | 'archived';

/** Section visibility + publish state */
export type CmsSectionStatus = 'draft' | 'published';

/** Where CMS runtime lives for a workspace/site */
export type CmsHostingMode = 'platform' | 'client_worker';

/** Bridge API profiles for BYO-runtime workers */
export type CmsApiProfile = 'primetch' | 'cpas_fragment' | 'fuel_admin';

/** Editor / storefront preview modes */
export type CmsPreviewMode = 'live' | 'embed' | 'preview-draft' | 'preview-published';

/** Outcome of save / publish — UI must distinguish these, not collapse to "saved" */
export type CmsPublishPhase =
  | 'saved_draft'
  | 'published_live'
  | 'preview_only'
  | 'failed_r2_write'
  | 'failed_d1_write'
  | 'failed_kv_purge'
  | 'failed_publish_lock';

export type CmsSection = {
  id: string;
  pageId: string;
  sectionType: string;
  name: string;
  r2Key?: string | null;
  visible: boolean;
  sortOrder: number;
  status: CmsSectionStatus;
  sectionData?: Record<string, unknown>;
};

/** Canonical CMS page contract (snake_case matches API JSON). */
export type CmsPage = {
  id: string;
  project_slug?: string;
  project_id?: string;
  slug?: string;
  route_path?: string;
  title?: string;
  status?: CmsPageStatus | string;
  page_type?: string;
  sort_order?: number;
  seo_title?: string;
  meta_description?: string;
  robots?: string;
  r2_key?: string | null;
  r2_bucket?: string | null;
  content_type?: string;
  published_at?: string | number | null;
  updated_at?: string | number | null;
};

/** D1 cms_page_sections row */
export type CmsPageSection = {
  id: string;
  page_id?: string;
  section_type?: string;
  section_name?: string;
  section_data?: unknown;
  sort_order?: number;
  is_visible?: boolean | number;
  updated_at?: string | number | null;
};

export type CmsPreviewUrls = {
  route_path: string;
  live_url: string;
  embed_url: string;
  preview_draft_url: string;
  preview_published_url: string;
  page_id: string;
};

export type CmsTenant = {
  id?: string;
  slug?: string;
  name?: string;
  domain?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  theme?: string | null;
};

export type CmsBootstrapData = {
  project_slug?: string;
  workspace_id?: string;
  workspace_name?: string | null;
  workspace_label?: string | null;
  resolved_from?: string | null;
  cms_hosting?: CmsHostingMode;
  public_domain?: string | null;
  tenant?: CmsTenant | null;
  pages?: CmsPage[];
  sections_by_page?: Record<string, CmsPageSection[]>;
  sections?: CmsPageSection[];
  components_by_section?: Record<string, unknown[]>;
  themes?: unknown[];
  active_theme?: { name?: string; slug?: string; accent?: string } | null;
  nav_menus?: unknown[];
  assets_3d?: unknown[];
  assets?: unknown[];
  imports?: unknown[];
  liquid_imports?: unknown[];
  global_settings?: unknown;
  active_draft?: unknown;
  live_session?: unknown;
  storage?: {
    r2_bucket?: string;
    r2_key?: string | null;
    bootstrap_cache_key?: string;
    kv_binding?: string;
    do_binding?: string;
  };
  _cache?: 'hit' | 'miss';
};

export type CmsPageDetailResponse = {
  page: CmsPage;
  content_url?: string | null;
  preview_html?: string;
  preview_mode?: 'draft' | 'published';
  live_url?: string;
  preview_urls?: CmsPreviewUrls;
  r2_key?: string | null;
  sections?: CmsPageSection[];
  components_by_section?: Record<string, unknown[]>;
  active_draft?: unknown;
};

export type CmsPublishResponse = {
  success?: boolean;
  ok?: boolean;
  id?: string;
  page_id?: string;
  r2_key?: string;
  r2_bucket?: string;
  status?: CmsPageStatus | string;
  phase?: CmsPublishPhase;
  preview_urls?: CmsPreviewUrls;
  kv_purged?: boolean;
  error?: string;
};

export type CmsSaveDraftResponse = {
  success?: boolean;
  r2_key?: string;
  status?: 'draft';
  kv_draft_key?: string;
  error?: string;
};

/** Map API section row → editor-friendly shape */
export function toCmsSection(row: CmsPageSection, pageId: string): CmsSection {
  return {
    id: row.id,
    pageId: row.page_id || pageId,
    sectionType: row.section_type || 'custom',
    name: row.section_name || row.id,
    visible: row.is_visible === 1 || row.is_visible === true,
    sortOrder: Number(row.sort_order) || 0,
    status: 'draft',
    sectionData:
      typeof row.section_data === 'object' && row.section_data != null
        ? (row.section_data as Record<string, unknown>)
        : undefined,
  };
}

/** Infer publish phase from API payload — use in editor toasts/buttons */
export function inferCmsPublishPhase(res: CmsPublishResponse): CmsPublishPhase {
  if (res.error) {
    const msg = String(res.error).toLowerCase();
    if (msg.includes('r2') || msg.includes('storage')) return 'failed_r2_write';
    if (msg.includes('kv') || msg.includes('cache')) return 'failed_kv_purge';
    if (msg.includes('d1') || msg.includes('database')) return 'failed_d1_write';
    if (msg.includes('lock')) return 'failed_publish_lock';
    return 'failed_d1_write';
  }
  const status = String(res.status || '').toLowerCase();
  if (status === 'published') return 'published_live';
  if (status === 'draft') return 'saved_draft';
  if (res.success || res.ok) return 'published_live';
  return 'preview_only';
}

export const CMS_PUBLISH_PHASE_LABEL: Record<CmsPublishPhase, string> = {
  saved_draft: 'Draft saved',
  published_live: 'Published live',
  preview_only: 'Preview only — not live',
  failed_r2_write: 'R2 write failed',
  failed_d1_write: 'Database update failed',
  failed_kv_purge: 'Published but cache purge failed',
  failed_publish_lock: 'Publish lock busy — retry',
};

/** PrimeTech agent loop — read → save → publish → verify */
export type CmsAgentLoopStep = 'read' | 'save' | 'publish' | 'verify';

export const CMS_PRIMETECH_AGENT_LOOP: readonly CmsAgentLoopStep[] = [
  'read',
  'save',
  'publish',
  'verify',
] as const;

export type CmsHtmlExcerpt = {
  r2_key: string | null;
  byte_length: number;
  excerpt: string;
};

/** agentsam_cms_read page payload */
export type CmsAgentReadResponse = {
  ok?: boolean;
  protocol?: string;
  page?: CmsPage;
  sections?: CmsPageSection[];
  preview_urls?: CmsPreviewUrls;
  html_draft?: CmsHtmlExcerpt | null;
  html_published?: CmsHtmlExcerpt | null;
  pages?: CmsPage[];
  error?: string;
};

export type CmsAgentSavePageHtmlResponse = {
  ok?: boolean;
  page_id?: string;
  draft_r2_key?: string;
  live_r2_key?: string;
  status?: CmsPageStatus | string;
  has_unpublished_draft?: boolean;
  byte_length?: number;
  next_step?: string;
  agent_applied?: boolean;
  error?: string;
};

export type CmsAgentSaveInjectedResponse = {
  ok?: boolean;
  page_id?: string;
  section_id?: string;
  section_name?: string;
  r2_key?: string;
  created?: boolean;
  preview_urls?: CmsPreviewUrls;
  next_step?: string;
  agent_applied?: boolean;
  error?: string;
};

export type CmsAgentPublishResponse = CmsPublishResponse & {
  phase?: CmsPublishPhase | 'published_live';
  live_url?: string;
  byte_length?: number;
  agent_applied?: boolean;
  next_step?: string;
  override_chain?: unknown[];
};

export type CmsAgentVerifyLiveChecks = {
  http_status: number;
  byte_length: number;
  title: string | null;
  is_clean_canvas: boolean;
  title_matches: boolean | null;
  snippet_found: boolean | null;
};

/** agentsam_cms_verify_live payload */
export type CmsAgentVerifyLiveResponse = {
  ok?: boolean;
  verified?: boolean;
  protocol_complete?: boolean;
  url?: string;
  live_url?: string;
  page_id?: string | null;
  checks?: CmsAgentVerifyLiveChecks;
  agent_applied?: boolean;
  error?: string;
};

/** Worker execution context (waitUntil for async side effects). */
export type CmsExecutionCtx = {
  waitUntil?: (p: Promise<unknown>) => void;
} | null;

export type ExecuteCmsPagePublishOpts = {
  pageId: string;
  page: CmsPage & Record<string, unknown>;
  workspaceId: string;
  tenantId: string;
  userId: string;
  executionCtx?: CmsExecutionCtx;
  /** true when invoked from Agent Sam tools; false for dashboard API publish */
  agentApplied?: boolean;
};

export type ExecuteCmsPagePublishSuccess = {
  ok: true;
  status: 'published';
  phase: 'published_live' | 'assembled_live';
  page_id: string;
  r2_key: string;
  r2_bucket: string;
  byte_length: number;
  bootstrap_cache_key: string;
  override_chain: unknown[];
  preview_urls: CmsPreviewUrls;
  live_url: string;
  agent_applied: boolean;
  revision?: unknown | null;
  trace?: unknown[];
  assemble?: unknown | null;
};

export type ExecuteCmsPagePublishFailure = {
  ok: false;
  error: string;
  holder?: string | null;
  contract?: unknown;
  promotion?: unknown;
  blocked?: string[];
};

export type ExecuteCmsPagePublishResult =
  | ExecuteCmsPagePublishSuccess
  | ExecuteCmsPagePublishFailure;
