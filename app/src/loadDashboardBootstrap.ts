/**
 * Single mount fetch for /dashboard/* — replaces parallel status-bar + workspace bootstrap calls.
 */

import {
  applyCachedCmsThemeFallback,
  applyCmsThemeToDocument,
  migrateLegacyThemeLocalStorage,
  type CmsActiveThemePayload,
} from './applyCmsTheme';
import {
  activePayloadFromFields,
  readThemeDraftMatchingActive,
} from '../components/themes/themeTweaksModel';
import { handleAuthHttpStatus } from './pwa/authSessionState';
import type { SessionUser } from '@inneranimalmedia/client-core';

export type DashboardBootstrapPayload = {
  ok?: boolean;
  fetched_at?: number;
  me?: {
    user?: Pick<SessionUser, 'id' | 'name' | 'email' | 'avatar_url'>;
    workspace?: { id?: string; name?: string; slug?: string } | null;
    capabilities?: {
      canRunPty?: boolean;
      canRunMcp?: boolean;
      canDeploy?: boolean;
    } | null;
    /** Resolved D1 session flags when auth/bootstrap includes them. */
    feature_flags?: Record<string, boolean | number | string> | null;
  };
  /** Optional top-level flags (future bootstrap L1). */
  feature_flags?: Record<string, boolean | number | string> | null;
  identity?: {
    workspace_id?: string | null;
    tenant_id?: string | null;
    github_repo?: string | null;
    capabilities?: {
      canRunPty?: boolean;
      canRunMcp?: boolean;
      canDeploy?: boolean;
    } | null;
  };
  workspaces?: {
    data?: Array<{
      id: string;
      name?: string;
      slug?: string;
      status?: string;
      github_repo?: string | null;
      database_studio_name?: string | null;
      handle?: string;
    }>;
    current?: string | null;
    current_source?: string | null;
  };
  status?: {
    health?: { status?: string };
    sandbox?: { ok?: boolean | null; deferred?: boolean };
    notifications?: Array<{ id?: string; title?: string; message?: string; created_at?: string }>;
    git?: { branch?: string | null; repo_full_name?: string | null; git_hash?: string | null };
    tunnel?: { healthy?: boolean | null; status?: string; deferred?: boolean; marker?: string };
    terminal?: {
      ready?: boolean;
      lane?: 'local' | 'cloud' | 'sandbox' | null;
      connection_id?: string | null;
      cwd?: string | null;
      status?: string;
      can_run_pty?: boolean;
    };
  };
  theme?: CmsActiveThemePayload | null;
  client?: {
    supabaseUrl?: string;
    supabaseAnonKey?: string;
    supabase_url?: string;
    supabase_anon_key?: string;
  } | null;
  _meta?: {
    l1_version?: number;
    parallel_queries?: number;
    l2_excluded?: string[];
  };
};

declare global {
  interface Window {
    __IAM_DASHBOARD_BOOTSTRAP__?: DashboardBootstrapPayload | null;
  }
}

let bootstrapPromise: Promise<DashboardBootstrapPayload | null> | null = null;

export function isDashboardBootstrapPath(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.startsWith('/dashboard');
}

/** Apply cms_themes payload from bootstrap before React shell mounts. */
export function applyDashboardBootstrapTheme(
  boot: DashboardBootstrapPayload | null | undefined,
  _workspaceId?: string | null,
): void {
  migrateLegacyThemeLocalStorage();
  const theme = boot?.theme;

  if (!theme || typeof theme !== 'object') {
    applyCachedCmsThemeFallback();
    return;
  }

  const activeRef = theme.slug?.trim() || '';
  const draft = activeRef ? readThemeDraftMatchingActive(activeRef) : null;
  if (draft) {
    applyCmsThemeToDocument(activePayloadFromFields(draft));
    return;
  }

  const hasVars =
    theme.data &&
    typeof theme.data === 'object' &&
    !Array.isArray(theme.data) &&
    Object.keys(theme.data).length > 0;

  if (!hasVars) {
    applyCachedCmsThemeFallback();
    return;
  }

  applyCmsThemeToDocument(theme);
}

function publishDashboardBootstrap(body: DashboardBootstrapPayload): DashboardBootstrapPayload {
  applyDashboardBootstrapTheme(body, body.workspaces?.current ?? null);
  if (typeof window !== 'undefined') {
    window.__IAM_DASHBOARD_BOOTSTRAP__ = body;
    window.dispatchEvent(new CustomEvent('iam_dashboard_bootstrap', { detail: body }));
    try {
      if (localStorage.getItem('IAM_DEBUG_L1') === '1') {
        console.info('[IAM L1] bootstrap published', {
          keys: Object.keys(body),
          l2_excluded: body._meta?.l2_excluded,
          parallel_queries: body._meta?.parallel_queries,
        });
      }
    } catch {
      /* ignore */
    }
  }
  return body;
}

export async function loadDashboardBootstrap(opts?: {
  force?: boolean;
}): Promise<DashboardBootstrapPayload | null> {
  if (!opts?.force && bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    try {
      const r = await fetch('/api/dashboard/bootstrap', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (r.status === 401) {
        handleAuthHttpStatus(401, '/api/dashboard/bootstrap');
        return null;
      }
      if (!r.ok) return null;
      const body = (await r.json()) as DashboardBootstrapPayload;
      return publishDashboardBootstrap(body);
    } catch {
      return null;
    }
  })();

  return bootstrapPromise;
}

/** Block React mount on /dashboard/* until bootstrap (theme + session context) is ready. */
export async function ensureDashboardBootstrapBeforeMount(): Promise<DashboardBootstrapPayload | null> {
  const cached = readDashboardBootstrapCache(60_000);
  if (cached) {
    applyDashboardBootstrapTheme(cached, cached.workspaces?.current ?? null);
    return cached;
  }
  return loadDashboardBootstrap();
}

export function readDashboardBootstrapCache(maxAgeMs = 30_000): DashboardBootstrapPayload | null {
  const cached = typeof window !== 'undefined' ? window.__IAM_DASHBOARD_BOOTSTRAP__ : null;
  if (!cached?.fetched_at) return null;
  if (Date.now() - Number(cached.fetched_at) > maxAgeMs) return null;
  return cached;
}

/** Force a fresh bootstrap after workspace switch; dashboard theme remains user-global. */
export async function refreshDashboardBootstrap(): Promise<DashboardBootstrapPayload | null> {
  bootstrapPromise = null;
  if (typeof window !== 'undefined') {
    window.__IAM_DASHBOARD_BOOTSTRAP__ = null;
  }
  return loadDashboardBootstrap({ force: true });
}
