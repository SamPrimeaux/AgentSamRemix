/**
 * Apply theme variables from GET /api/themes/active (live D1 config → `data`, plus Monaco metadata).
 * Source of truth for preview/edit is always D1 `cms_themes.config` merged server-side — not R2 `theme.css`.
 * Compiled CSS on R2 (`css_url`) is for public routes, published HTML, exports, and cacheable snapshots only.
 */

/** localStorage keys — Inner Animal Media dashboard only (legacy mcad_* removed on read). */
export const INNERANIMALMEDIA_LS_THEME_CSS = 'inneranimalmedia_theme_css';
export const INNERANIMALMEDIA_LS_THEME_SLUG = 'inneranimalmedia_theme_slug';
export const INNERANIMALMEDIA_LS_THEME_IS_DARK = 'inneranimalmedia_theme_is_dark';
/** Legacy workspace cache pointer; retained only so old clients can be cleaned up safely. */
export const INNERANIMALMEDIA_LS_THEME_LAST_WS = 'inneranimalmedia_theme_last_ws';

export function themeCssStorageKey(_workspaceId: string | null | undefined): string {
  return INNERANIMALMEDIA_LS_THEME_CSS;
}

export function themeSlugStorageKey(_workspaceId: string | null | undefined): string {
  return INNERANIMALMEDIA_LS_THEME_SLUG;
}

export function themeIsDarkStorageKey(_workspaceId: string | null | undefined): string {
  return INNERANIMALMEDIA_LS_THEME_IS_DARK;
}

const INNERANIMALMEDIA_LS_THEME_MONACO = 'inneranimalmedia_theme_monaco';
const INNERANIMALMEDIA_LS_THEME_MONACO_DATA = 'inneranimalmedia_theme_monaco_data';
const INNERANIMALMEDIA_LS_THEME_MONACO_BG = 'inneranimalmedia_theme_monaco_bg';

export function themeMonacoStorageKey(_workspaceId: string | null | undefined): string {
  return INNERANIMALMEDIA_LS_THEME_MONACO;
}

export function themeMonacoDataStorageKey(_workspaceId: string | null | undefined): string {
  return INNERANIMALMEDIA_LS_THEME_MONACO_DATA;
}

export function themeMonacoBgStorageKey(_workspaceId: string | null | undefined): string {
  return INNERANIMALMEDIA_LS_THEME_MONACO_BG;
}

import type { AgentHomeCmsConfig } from '../types/agentHomeScene';
import { applyAgentHomeCmsToDocument, dispatchAgentHomeScenePreview } from '../lib/agentHomeSceneResolve';
const LEGACY_MCAD_SLUG = 'mcad_theme_slug';
const LEGACY_MCAD_IS_DARK = 'mcad_theme_is_dark';

export type CmsActiveThemePayload = {
  slug?: string;
  name?: string;
  is_dark?: boolean;
  workspace_id?: string | null;
  project_id?: string | null;
  /** Live D1-backed styling (`live`); R2 snapshot URL is metadata only for published/public consumers. */
  theme_channel?: 'live' | string;
  /** Compiled snapshot URL on R2 — do not fetch for authenticated realtime theme apply; use `data`. */
  css_url?: string | null;
  compiled_css_hash?: string | null;
  resolved_from?: string;
  /** From `cms_themes.monaco_theme` or `{slug}-monaco` derived server-side from the same row (never invented in the client). */
  monaco_theme?: string | null;
  /** From `cms_themes.monaco_bg`. */
  monaco_bg?: string | null;
  /** From `cms_themes.monaco_theme_data` (full `IStandaloneThemeData` JSON string). */
  monaco_theme_data?: string | null;
  data?: Record<string, string>;
  agent_home?: import('../types/agentHomeScene').AgentHomeCmsConfig | null;
};

/**
 * Mirrors `GET /api/themes/active` Monaco fields onto `<html>`. No guessing: missing values → attribute removed;
 * MonacoSurface waits until both `data-monaco-theme` and `data-monaco-theme-data` are present.
 */
export function syncMonacoHtmlDataAttributes(
  payload: Pick<CmsActiveThemePayload, 'monaco_theme' | 'monaco_bg' | 'monaco_theme_data'>,
): void {
  const root = document.documentElement;

  const mt =
    payload.monaco_theme != null && String(payload.monaco_theme).trim() !== ''
      ? String(payload.monaco_theme).trim()
      : '';
  const mb =
    payload.monaco_bg != null && String(payload.monaco_bg).trim() !== ''
      ? String(payload.monaco_bg).trim()
      : '';
  const md =
    payload.monaco_theme_data != null && String(payload.monaco_theme_data).trim() !== ''
      ? String(payload.monaco_theme_data).trim()
      : '';

  if (mt) root.setAttribute('data-monaco-theme', mt);
  else root.removeAttribute('data-monaco-theme');

  if (mb) root.setAttribute('data-monaco-bg', mb);
  else root.removeAttribute('data-monaco-bg');

  if (md) root.setAttribute('data-monaco-theme-data', md);
  else root.removeAttribute('data-monaco-theme-data');

  try {
    window.dispatchEvent(new CustomEvent('iam:cms-theme-applied'));
  } catch {
    /* ignore */
  }
}

/** One-time read: copy legacy mcad_* keys into inneranimalmedia_* then drop legacy. */
export function migrateLegacyThemeLocalStorage(): void {
  try {
    if (!localStorage.getItem(INNERANIMALMEDIA_LS_THEME_CSS)) {
      const c = localStorage.getItem(LEGACY_MCAD_CSS);
      if (c) {
        localStorage.setItem(INNERANIMALMEDIA_LS_THEME_CSS, c);
        localStorage.removeItem(LEGACY_MCAD_CSS);
      }
    } else {
      localStorage.removeItem(LEGACY_MCAD_CSS);
    }
    if (!localStorage.getItem(INNERANIMALMEDIA_LS_THEME_SLUG)) {
      const s = localStorage.getItem(LEGACY_MCAD_SLUG);
      if (s) {
        localStorage.setItem(INNERANIMALMEDIA_LS_THEME_SLUG, s);
        localStorage.removeItem(LEGACY_MCAD_SLUG);
      }
    } else {
      localStorage.removeItem(LEGACY_MCAD_SLUG);
    }
    const dNew = localStorage.getItem(INNERANIMALMEDIA_LS_THEME_IS_DARK);
    if (dNew !== '1' && dNew !== '0') {
      const d = localStorage.getItem(LEGACY_MCAD_IS_DARK);
      if (d === '1' || d === '0') {
        localStorage.setItem(INNERANIMALMEDIA_LS_THEME_IS_DARK, d);
      }
    }
    localStorage.removeItem(LEGACY_MCAD_IS_DARK);
  } catch {
    /* ignore */
  }
}

/** Call after live CMS vars are applied so dashboard alias tokens reject shell.css leakage. */
export function markDashboardThemeApplied(slug?: string | null): void {
  document.documentElement.setAttribute('data-dashboard-theme-ready', 'true');
  const s = slug != null && String(slug).trim() !== '' ? String(slug).trim() : null;
  if (s) document.documentElement.setAttribute('data-cms-theme', s);
  else document.documentElement.removeAttribute('data-cms-theme');
}

/** `?theme_debug=1` — logs resolved tokens (computed) for diagnosing shell vs Agent vs workspace drift. */
export function logDashboardThemeDebug(): void {
  if (typeof window === 'undefined') return;
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('theme_debug') !== '1') return;
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const md = root.getAttribute('data-monaco-theme-data');
    let themeDataBase = '';
    let editorBackground = '';
    try {
      if (md && md.trim()) {
        const parsed = JSON.parse(md) as { base?: string; colors?: Record<string, string> };
        themeDataBase = parsed.base != null ? String(parsed.base) : '';
        editorBackground = parsed.colors?.['editor.background']?.trim() ?? '';
      }
    } catch {
      /* ignore */
    }
    console.info('[iam theme_debug]', {
      slug: root.getAttribute('data-cms-theme'),
      theme_ready: root.getAttribute('data-dashboard-theme-ready'),
      data_monaco_theme: root.getAttribute('data-monaco-theme'),
      data_monaco_bg: root.getAttribute('data-monaco-bg'),
      has_monaco_theme_data: !!(md && md.trim()),
      monaco_theme_data_len: md?.length ?? 0,
      themeDataBase,
      editorBackground,
      '--bg-canvas': cs.getPropertyValue('--bg-canvas').trim(),
      '--bg-app': cs.getPropertyValue('--bg-app').trim(),
      '--bg-panel': cs.getPropertyValue('--bg-panel').trim(),
      '--dashboard-canvas': cs.getPropertyValue('--dashboard-canvas').trim(),
      '--dashboard-panel': cs.getPropertyValue('--dashboard-panel').trim(),
    });
  } catch {
    /* ignore */
  }
}

export function applyCmsThemeToDocument(payload: CmsActiveThemePayload): boolean {
  const wsCtx = null;
  const kCss = themeCssStorageKey(wsCtx);
  const kSlug = themeSlugStorageKey(wsCtx);
  const kDark = themeIsDarkStorageKey(wsCtx);
  const kMonaco = themeMonacoStorageKey(wsCtx);
  const kMonacoData = themeMonacoDataStorageKey(wsCtx);
  const kMonacoBg = themeMonacoBgStorageKey(wsCtx);

  /** Keys from last applied theme for this storage bucket — strip orphans before set (inline vars persist otherwise). */
  let prevCssVarKeys: string[] = [];
  try {
    const prevRaw = localStorage.getItem(kCss);
    if (prevRaw && prevRaw.trim()) {
      const prev = JSON.parse(prevRaw) as Record<string, unknown>;
      if (prev && typeof prev === 'object' && !Array.isArray(prev)) {
        prevCssVarKeys = Object.keys(prev).filter((k) => typeof k === 'string' && k.startsWith('--'));
      }
    }
  } catch {
    /* ignore */
  }

  const vars = payload.data;
  let applied = false;
  if (vars && typeof vars === 'object' && Object.keys(vars).length > 0) {
    applied = true;
    const root = document.documentElement;
    const nextKeys = new Set(
      Object.keys(vars).filter((k) => typeof k === 'string' && k.startsWith('--')),
    );
    for (const k of prevCssVarKeys) {
      if (!nextKeys.has(k)) {
        root.style.removeProperty(k);
      }
    }
    Object.entries(vars).forEach(([k, v]) => {
      if (v == null || k == null) return;
      root.style.setProperty(k, String(v));
    });
    try {
      /* DB / API wins over any stale first-paint cache */
      localStorage.setItem(kCss, JSON.stringify(vars));
      localStorage.removeItem(LEGACY_MCAD_CSS);
    } catch {
      /* ignore quota */
    }
  }
  if (payload.slug) {
    try {
      localStorage.setItem(kSlug, payload.slug);
      localStorage.removeItem(LEGACY_MCAD_SLUG);
    } catch {
      /* ignore */
    }
  }
  try {
    if (payload.monaco_theme != null && String(payload.monaco_theme).trim() !== '') {
      localStorage.setItem(kMonaco, String(payload.monaco_theme).trim());
    } else {
      localStorage.removeItem(kMonaco);
    }
    const md =
      payload.monaco_theme_data != null && String(payload.monaco_theme_data).trim() !== ''
        ? String(payload.monaco_theme_data)
        : '';
    if (md) {
      localStorage.setItem(kMonacoData, md);
    } else {
      localStorage.removeItem(kMonacoData);
    }
    if (payload.monaco_bg != null && String(payload.monaco_bg).trim() !== '') {
      localStorage.setItem(kMonacoBg, String(payload.monaco_bg).trim());
    } else {
      localStorage.removeItem(kMonacoBg);
    }
  } catch {
    /* ignore */
  }
  if (typeof payload.is_dark === 'boolean') {
    document.documentElement.setAttribute('data-theme', payload.slug ?? (payload.is_dark ? 'dark' : 'light'));
    document.documentElement.classList.toggle('dark', payload.is_dark === true);
    try {
      localStorage.setItem(kDark, payload.is_dark ? '1' : '0');
      localStorage.removeItem(LEGACY_MCAD_IS_DARK);
    } catch {
      /* ignore */
    }
  }
  syncMonacoHtmlDataAttributes(payload);
  if (payload.agent_home && payload.agent_home.version === 1) {
    applyAgentHomeCmsToDocument(payload.agent_home as AgentHomeCmsConfig);
    dispatchAgentHomeScenePreview(payload.agent_home as AgentHomeCmsConfig);
  }
  markDashboardThemeApplied(payload.slug ?? null);
  logDashboardThemeDebug();
  return applied;
}

function activeThemeUrl(_workspaceId: string | null | undefined): string {
  return '/api/themes/active';
}

function preferencesUrl(_workspaceId: string | null | undefined): string {
  return '/api/user/preferences';
}

type CatalogThemeRow = {
  slug?: string;
  name?: string;
  is_dark?: boolean;
  config?: unknown;
};

function catalogRowToActivePayload(row: CatalogThemeRow): CmsActiveThemePayload | null {
  const slug = row.slug?.trim();
  if (!slug) return null;
  let config: Record<string, unknown> = {};
  const raw = row.config;
  if (typeof raw === 'string') {
    try {
      config = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      config = {};
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    config = raw as Record<string, unknown>;
  }
  const cssVars = (config.cssVars ?? config.css_vars) as Record<string, string> | undefined;
  const data: Record<string, string> = {};
  if (cssVars && typeof cssVars === 'object') {
    for (const [k, v] of Object.entries(cssVars)) {
      if (typeof v === 'string') data[k] = v;
    }
  } else {
    for (const [k, v] of Object.entries(config)) {
      if (k.startsWith('--') && typeof v === 'string') data[k] = v;
    }
  }
  return {
    slug,
    name: row.name ?? slug,
    is_dark: row.is_dark === true,
    data,
    theme_channel: 'live',
  };
}

/** GET /api/themes/active, else catalog + GET /api/user/preferences theme_preset. */
async function fetchActiveThemePayload(
  workspaceId: string | null | undefined,
  init?: { signal?: AbortSignal },
): Promise<CmsActiveThemePayload | null> {
  const fetchInit = { credentials: 'same-origin' as const, signal: init?.signal, cache: 'no-store' as const };

  const activeRes = await fetch(activeThemeUrl(workspaceId), fetchInit);
  if (activeRes.ok) {
    return (await activeRes.json()) as CmsActiveThemePayload;
  }

  const prefRes = await fetch(preferencesUrl(workspaceId), fetchInit);
  if (!prefRes.ok) return null;
  const prefs = (await prefRes.json()) as { theme_preset?: string };
  const slug = prefs.theme_preset?.trim();
  if (!slug) return null;

  const themesRes = await fetch('/api/themes', fetchInit);
  if (!themesRes.ok) return null;
  const list = (await themesRes.json()) as { themes?: CatalogThemeRow[] };
  const row = (list.themes || []).find((t) => t.slug === slug);
  return row ? catalogRowToActivePayload(row) : null;
}

const WEAK_THEME_RESOLVED_FROM = new Set([
  'system_default',
  'none',
  'no_db',
  'resolve_error',
  'settings.appearance.theme',
  'workspace_settings',
  'workspaces',
  'user_settings.theme',
]);

function countThemeCssVars(vars: Record<string, string> | null | undefined): number {
  if (!vars || typeof vars !== 'object') return 0;
  return Object.keys(vars).filter((k) => k.startsWith('--')).length;
}

function readWorkspaceThemeCache(workspaceId: string): {
  vars: Record<string, string>;
  slug: string | null;
} | null {
  try {
    const cached = localStorage.getItem(themeCssStorageKey(workspaceId));
    if (!cached) return null;
    const vars = JSON.parse(cached) as Record<string, string>;
    if (!vars || typeof vars !== 'object' || countThemeCssVars(vars) === 0) return null;
    const slug = localStorage.getItem(themeSlugStorageKey(workspaceId));
    return { vars, slug: slug?.trim() || null };
  } catch {
    return null;
  }
}

/** Prefer localStorage when API returns empty/sparse data or weak resolution (common after deploy). */
function shouldPreferLocalThemeCacheOverApi(
  raw: CmsActiveThemePayload,
  workspaceId: string,
): boolean {
  const cache = readWorkspaceThemeCache(workspaceId);
  if (!cache) return false;

  const apiVars =
    raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : {};
  const apiCount = countThemeCssVars(apiVars);
  const cacheCount = countThemeCssVars(cache.vars);

  if (apiCount === 0) return true;
  if (raw.resolved_from && WEAK_THEME_RESOLVED_FROM.has(raw.resolved_from)) return true;
  if (raw.slug === 'dark' && cache.slug && cache.slug !== 'dark') return true;
  if (cacheCount > apiCount + 3) return true;
  return false;
}

/** Load active theme from API and apply to :root. Returns parsed payload or null. */
export async function fetchAndApplyActiveCmsTheme(
  workspaceId: string | null | undefined,
  init?: { signal?: AbortSignal },
): Promise<CmsActiveThemePayload | null> {
  const raw = await fetchActiveThemePayload(workspaceId, init);
  if (!raw || init?.signal?.aborted) return null;

  const ws = workspaceId?.trim();
  if (ws && shouldPreferLocalThemeCacheOverApi(raw, ws)) {
    applyCachedCmsThemeFallbackForWorkspace(ws);
    return raw;
  }

  applyCmsThemeToDocument(raw);
  return raw;
}

/** Read active slug for UI (e.g. ThemeSwitcher highlight) without re-applying vars. */
export async function fetchActiveCmsThemeSlug(
  workspaceId: string | null | undefined,
): Promise<string | null> {
  const raw = await fetchActiveThemePayload(workspaceId);
  return typeof raw?.slug === 'string' ? raw.slug : null;
}

/** First paint: use one browser cache for the authenticated user's dashboard appearance. */
export function applyCachedCmsThemeFallback(): boolean {
  migrateLegacyThemeLocalStorage();
  return applyCachedLegacyGlobalThemeFallback();
}

/** Compatibility signature: workspace switching no longer selects a dashboard theme bucket. */
export function applyCachedCmsThemeFallbackForWorkspace(_workspaceId: string | null | undefined): boolean {
  migrateLegacyThemeLocalStorage();
  return applyCachedLegacyGlobalThemeFallback();
}

function applyCachedLegacyGlobalThemeFallback(): boolean {
  try {
    const cached = localStorage.getItem(INNERANIMALMEDIA_LS_THEME_CSS);
    if (!cached) return false;
    const vars = JSON.parse(cached) as Record<string, string>;
    if (!vars || typeof vars !== 'object') return false;
    const d = localStorage.getItem(INNERANIMALMEDIA_LS_THEME_IS_DARK);
    const slug = localStorage.getItem(INNERANIMALMEDIA_LS_THEME_SLUG);
    const payload: CmsActiveThemePayload = { data: vars };
    if (slug) payload.slug = slug;
    if (d === '1' || d === '0') payload.is_dark = d === '1';
    const cachedMt = localStorage.getItem(INNERANIMALMEDIA_LS_THEME_MONACO)?.trim();
    const cachedMd = localStorage.getItem(INNERANIMALMEDIA_LS_THEME_MONACO_DATA);
    const cachedMb = localStorage.getItem(INNERANIMALMEDIA_LS_THEME_MONACO_BG)?.trim();
    if (cachedMt) payload.monaco_theme = cachedMt;
    if (cachedMd) payload.monaco_theme_data = cachedMd;
    if (cachedMb) payload.monaco_bg = cachedMb;
    return applyCmsThemeToDocument(payload);
  } catch {
    return false;
  }
}
