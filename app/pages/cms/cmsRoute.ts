import {
  buildCmsHubPath as buildCoreCmsHubPath,
  buildCmsPath as buildCoreCmsPath,
  parseCmsRoute as parseCoreCmsRoute,
  isCmsStudioEditorRoute as isCoreCmsStudioEditorRoute,
  isCmsEditorFullscreenRoute as isCoreCmsEditorFullscreenRoute,
} from '../../src/core/agentsam/cms/routing/index.js';

/** Workspace-scoped localStorage key — server SSOT is agentsam_bootstrap.ui_preferences_json.cms_project_slug */
export function cmsProjectStorageKey(workspaceId: string | null | undefined): string {
  const ws = String(workspaceId || '').trim();
  return ws ? `iam_cms_project:${ws}` : 'iam_cms_project';
}

export function readStoredCmsProjectSlug(workspaceId: string | null | undefined): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const scoped = localStorage.getItem(cmsProjectStorageKey(workspaceId));
    if (scoped) return scoped;
    const legacy = localStorage.getItem('iam_cms_project');
    return legacy || null;
  } catch {
    return null;
  }
}

export function writeStoredCmsProjectSlug(
  workspaceId: string | null | undefined,
  projectSlug: string | null | undefined,
): void {
  if (typeof localStorage === 'undefined' || !projectSlug) return;
  try {
    localStorage.setItem(cmsProjectStorageKey(workspaceId), String(projectSlug).trim());
  } catch {
    /* ignore */
  }
}

export type CmsView =
  | 'sites'
  | 'hub'
  | 'pages'
  | 'templates'
  | 'imports'
  | 'media'
  | 'online-store'
  | 'theme-editor';

export type CmsPanel = 'pages' | 'templates' | 'imports' | 'media' | 'online-store' | 'theme-editor';

export type ParsedCmsRoute = {
  view: CmsView;
  siteSlug: string | null;
  pageId: string | null;
  panel: CmsPanel;
  legacy: boolean;
  legacyTarget: string | null;
};

/** Compatibility facade. Canonical route semantics live in src/core/agentsam/cms/routing/. */
export function buildCmsHubPath(siteSlug?: string | null): string {
  return buildCoreCmsHubPath(siteSlug) as string;
}

export function buildCmsPath(opts: {
  panel?: CmsPanel;
  pageId?: string | null;
  siteSlug?: string | null;
}): string {
  return buildCoreCmsPath(opts) as string;
}

export function parseCmsRoute(pathname: string, searchParams: URLSearchParams): ParsedCmsRoute {
  return parseCoreCmsRoute(pathname, searchParams) as ParsedCmsRoute;
}

export function isCmsStudioEditorRoute(pathname: string, searchParams: URLSearchParams): boolean {
  return Boolean(isCoreCmsStudioEditorRoute(pathname, searchParams));
}

export function isCmsEditorFullscreenRoute(pathname: string, searchParams: URLSearchParams): boolean {
  return Boolean(isCoreCmsEditorFullscreenRoute(pathname, searchParams));
}
