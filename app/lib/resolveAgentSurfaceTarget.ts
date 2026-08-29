/**
 * Resolve Agent Sam SSE `surface_open` payloads into concrete workbench actions.
 * Supports CMS, localhost, local files, and R2 — not URL-only routing.
 */

export type AgentSurfaceTarget =
  | { kind: 'cms_panel'; project_slug: string; page_id?: string; panel?: string }
  | { kind: 'cms_preview_url'; url: string; page_id?: string }
  | { kind: 'live_site'; domain: string }
  | { kind: 'localhost'; port?: number }
  | { kind: 'devserver' }
  | { kind: 'local_file'; workspace_path: string }
  | { kind: 'r2'; bucket: string; key: string; preview?: boolean }
  | { kind: 'github'; repo: string; path: string; branch?: string }
  | { kind: 'url'; url: string }
  | { kind: 'surface_only'; surface: 'code' | 'terminal' | 'r2' | 'cms' | 'browser' };

export type AgentSurfaceOpenDetail = {
  surface?: string;
  url?: string;
  load_url?: string;
  artifact_id?: string;
  artifact_type?: string;
  reason?: string;
  automation?: boolean;
  agent_live?: boolean;
  project_slug?: string;
  page_id?: string;
  panel?: string;
  bucket?: string;
  key?: string;
  workspace_path?: string;
  github_repo?: string;
  github_path?: string;
  github_branch?: string;
  port?: number;
  domain?: string;
  target?: AgentSurfaceTarget | Record<string, unknown> | null;
};

export type ResolvedAgentSurfaceAction = {
  surface: 'browser' | 'code' | 'cms' | 'r2' | 'terminal' | 'excalidraw' | 'sketch' | 'moviemode' | null;
  browserUrl?: string | null;
  cms?: { project_slug: string; page_id?: string | null; panel?: string | null };
  localFile?: { workspace_path: string };
  r2?: { bucket: string; key: string; preview?: boolean };
  github?: { repo: string; path: string; branch?: string };
  excalidraw?: { load_url?: string | null; artifact_id?: string | null };
  sketch?: {
    elements?: unknown[];
    mode?: 'sketch' | 'layout' | 'blueprint';
    name?: string;
  };
  automation?: boolean;
  agent_live?: boolean;
  reason?: string;
};

function isHtmlArtifactKey(key: string): boolean {
  return /\.(?:html?|dc\.html)$/i.test(key.trim());
}

function normalizeTarget(raw: unknown): AgentSurfaceTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = String(o.kind || '').trim();
  if (!kind) return null;
  switch (kind) {
    case 'cms_panel':
      return {
        kind: 'cms_panel',
        project_slug: String(o.project_slug || '').trim(),
        page_id: o.page_id != null ? String(o.page_id).trim() : undefined,
        panel: o.panel != null ? String(o.panel).trim() : undefined,
      };
    case 'cms_preview_url':
      return {
        kind: 'cms_preview_url',
        url: String(o.url || '').trim(),
        page_id: o.page_id != null ? String(o.page_id).trim() : undefined,
      };
    case 'live_site':
      return { kind: 'live_site', domain: String(o.domain || '').trim() };
    case 'localhost':
      return {
        kind: 'localhost',
        port: o.port != null ? Number(o.port) : undefined,
      };
    case 'devserver':
      return { kind: 'devserver' };
    case 'local_file':
      return {
        kind: 'local_file',
        workspace_path: String(o.workspace_path || '').trim(),
      };
    case 'r2':
      return {
        kind: 'r2',
        bucket: String(o.bucket || '').trim(),
        key: String(o.key || '').trim(),
        preview: o.preview === true,
      };
    case 'github':
      return {
        kind: 'github',
        repo: String(o.repo || o.github_repo || '').trim(),
        path: String(o.path || o.github_path || '').trim(),
        branch: o.branch != null ? String(o.branch).trim() : undefined,
      };
    case 'url':
      return { kind: 'url', url: String(o.url || '').trim() };
    case 'surface_only': {
      const surface = String(o.surface || '').trim().toLowerCase();
      if (surface === 'code' || surface === 'terminal' || surface === 'r2' || surface === 'cms' || surface === 'browser') {
        return { kind: 'surface_only', surface };
      }
      return null;
    }
    default:
      return null;
  }
}

function inferTargetFromLegacy(detail: AgentSurfaceOpenDetail): AgentSurfaceTarget | null {
  const surface = String(detail.surface || '').toLowerCase();
  const url = String(detail.url || detail.load_url || '').trim();
  if (surface === 'cms') {
    const slug = String(detail.project_slug || '').trim();
    if (slug) {
      return {
        kind: 'cms_panel',
        project_slug: slug,
        page_id: detail.page_id?.trim() || undefined,
        panel: detail.panel?.trim() || undefined,
      };
    }
    return { kind: 'surface_only', surface: 'cms' };
  }
  if (url) {
    if (/^https?:\/\/localhost(?::\d+)?/i.test(url)) {
      const portMatch = url.match(/:(\d+)/);
      return { kind: 'localhost', port: portMatch ? Number(portMatch[1]) : undefined };
    }
    return { kind: 'url', url };
  }
  if (detail.workspace_path?.trim()) {
    return { kind: 'local_file', workspace_path: detail.workspace_path.trim() };
  }
  if (detail.bucket?.trim() && detail.key?.trim()) {
    return { kind: 'r2', bucket: detail.bucket.trim(), key: detail.key.trim(), preview: true };
  }
  if (detail.github_repo?.trim() && detail.github_path?.trim()) {
    return {
      kind: 'github',
      repo: detail.github_repo.trim(),
      path: detail.github_path.trim(),
      branch: detail.github_branch?.trim(),
    };
  }
  if (surface === 'code' || surface === 'monaco') {
    return { kind: 'surface_only', surface: 'code' };
  }
  if (surface === 'browser') {
    return { kind: 'surface_only', surface: 'browser' };
  }
  if (surface === 'r2') {
    return { kind: 'surface_only', surface: 'r2' };
  }
  if (detail.port != null && Number.isFinite(Number(detail.port))) {
    return { kind: 'localhost', port: Number(detail.port) };
  }
  if (detail.domain?.trim()) {
    return { kind: 'live_site', domain: detail.domain.trim() };
  }
  return null;
}

/** Map SSE detail (+ optional explicit target) to a host workbench action. */
export function resolveAgentSurfaceTarget(detail: AgentSurfaceOpenDetail): ResolvedAgentSurfaceAction {
  const target = normalizeTarget(detail.target) ?? inferTargetFromLegacy(detail);
  const base: ResolvedAgentSurfaceAction = {
    surface: null,
    automation: detail.automation,
    agent_live: detail.agent_live,
    reason: detail.reason,
  };

  if (!target) {
    const s = String(detail.surface || '').toLowerCase();
    if (s === 'excalidraw' || s === 'draw') {
      return {
        ...base,
        surface: 'excalidraw',
        excalidraw: {
          load_url: detail.load_url?.trim() || null,
          artifact_id: detail.artifact_id?.trim() || null,
        },
      };
    }
    if (s === 'sketch' || s === 'wireframe' || s === 'studio' || s === 'figma') {
      const elements = Array.isArray((detail as { elements?: unknown[] }).elements)
        ? ((detail as { elements: unknown[] }).elements)
        : undefined;
      return {
        ...base,
        surface: 'sketch',
        sketch: {
          elements,
          mode: (detail as { mode?: 'sketch' | 'layout' | 'blueprint' }).mode,
          name: (detail as { name?: string }).name?.trim() || undefined,
        },
      };
    }
    if (s === 'moviemode' || s === 'movie') return { ...base, surface: 'moviemode' };
    if (s === 'browser') return { ...base, surface: 'browser', browserUrl: detail.url?.trim() || null };
    if (s === 'monaco' || s === 'code') return { ...base, surface: 'code' };
    if (s === 'cms') return { ...base, surface: 'cms' };
    if (s === 'r2') return { ...base, surface: 'r2' };
    return base;
  }

  switch (target.kind) {
    case 'cms_panel':
      return {
        ...base,
        surface: 'cms',
        cms: {
          project_slug: target.project_slug,
          page_id: target.page_id ?? null,
          panel: target.panel ?? null,
        },
      };
    case 'cms_preview_url':
      return {
        ...base,
        surface: 'browser',
        browserUrl: target.url,
      };
    case 'live_site':
      return {
        ...base,
        surface: 'browser',
        browserUrl: target.domain.startsWith('http') ? target.domain : `https://${target.domain}`,
      };
    case 'localhost':
      return {
        ...base,
        surface: 'browser',
        browserUrl: target.port ? `http://localhost:${target.port}` : 'http://localhost',
      };
    case 'devserver':
      return { ...base, surface: 'browser' };
    case 'local_file':
      return { ...base, surface: 'code', localFile: { workspace_path: target.workspace_path } };
    case 'r2':
      return {
        ...base,
        surface: target.preview && isHtmlArtifactKey(target.key) ? 'code' : target.preview ? 'browser' : 'r2',
        r2: { bucket: target.bucket, key: target.key, preview: target.preview },
      };
    case 'github':
      return { ...base, surface: 'code', github: target };
    case 'url':
      return { ...base, surface: 'browser', browserUrl: target.url };
    case 'surface_only':
      return { ...base, surface: target.surface };
    default:
      return base;
  }
}
