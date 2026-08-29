import type { CatalogTheme } from './ThemePreviewCard';

export type ThemeTweakFields = {
  name: string;
  slug: string;
  theme_family: 'light' | 'dark';
  preview_image_url: string;
  canvas: string;
  panel: string;
  shell: string;
  nav: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  primaryHover: string;
  textNav: string;
  textSidebar: string;
  monacoBg: string;
  glowPrimary: string;
  glowSecondary: string;
  syncNavShell: boolean;
};

export const DEFAULT_TWEAK_FIELDS: ThemeTweakFields = {
  name: 'New Theme',
  slug: 'new-theme',
  theme_family: 'light',
  preview_image_url: '',
  canvas: '#F4F4F5',
  panel: '#FFFFFF',
  shell: '#202223',
  nav: '#202223',
  text: '#202223',
  muted: '#616161',
  border: '#E1E3E5',
  primary: '#2563EB',
  primaryHover: '#1D4ED8',
  textNav: '#F4F4F5',
  textSidebar: '#F4F4F5',
  monacoBg: '#F6F6F7',
  glowPrimary: '#2563EB',
  glowSecondary: '#60A5FA',
  syncNavShell: true,
};

function readCssVar(map: Record<string, string>, keys: string[], fallback = ''): string {
  for (const k of keys) {
    const v = map[k];
    if (v?.trim()) return v.trim();
  }
  return fallback;
}

export function fieldsFromTheme(theme: CatalogTheme | null): ThemeTweakFields {
  if (!theme) return { ...DEFAULT_TWEAK_FIELDS };
  const parsed = (theme as { parsed?: { config?: Record<string, unknown>; cssVarsMerged?: Record<string, string> } })
    .parsed;
  const cfg = parsed?.config || {};
  const cv = parsed?.cssVarsMerged || {};
  const shell = readCssVar(cv, ['--bg-shell'], String(cfg.nav || ''));
  const nav = readCssVar(cv, ['--bg-nav'], String(cfg.nav || shell));
  return {
    name: theme.name || theme.slug,
    slug: theme.slug,
    theme_family: (theme.theme_family === 'dark' ? 'dark' : 'light') as 'light' | 'dark',
    preview_image_url: theme.preview_image_url || '',
    canvas: readCssVar(cv, ['--bg-canvas', '--bg-app'], String(cfg.bg || DEFAULT_TWEAK_FIELDS.canvas)),
    panel: readCssVar(cv, ['--bg-panel'], String(cfg.surface || DEFAULT_TWEAK_FIELDS.panel)),
    shell: shell || nav,
    nav: nav || shell,
    text: readCssVar(cv, ['--text-main', '--text-primary'], String(cfg.text || DEFAULT_TWEAK_FIELDS.text)),
    muted: readCssVar(cv, ['--text-muted'], String(cfg.textSecondary || DEFAULT_TWEAK_FIELDS.muted)),
    border: readCssVar(cv, ['--border', '--border-subtle'], String(cfg.border || DEFAULT_TWEAK_FIELDS.border)),
    primary: readCssVar(cv, ['--color-primary'], String(cfg.primary || DEFAULT_TWEAK_FIELDS.primary)),
    primaryHover: readCssVar(cv, ['--accent-hover'], String(cfg.primaryHover || DEFAULT_TWEAK_FIELDS.primaryHover)),
    glowPrimary: readCssVar(
      cv,
      ['--agent-home-glow-primary'],
      readCssVar(cv, ['--color-primary'], String(cfg.primary || DEFAULT_TWEAK_FIELDS.glowPrimary)),
    ),
    glowSecondary: readCssVar(
      cv,
      ['--agent-home-glow-secondary'],
      readCssVar(
        cv,
        ['--solar-blue', '--solar-cyan'],
        DEFAULT_TWEAK_FIELDS.glowSecondary,
      ),
    ),
    textNav: readCssVar(cv, ['--text-nav'], DEFAULT_TWEAK_FIELDS.textNav),
    textSidebar: readCssVar(cv, ['--text-sidebar'], readCssVar(cv, ['--text-nav'], DEFAULT_TWEAK_FIELDS.textSidebar)),
    monacoBg: readCssVar(cv, ['--editor-bg'], theme.preview_model?.monacoBg || DEFAULT_TWEAK_FIELDS.monacoBg),
    syncNavShell: shell === nav || !shell || !nav,
  };
}

export function cssVarsFromFields(f: ThemeTweakFields): Record<string, string> {
  const shell = f.syncNavShell ? f.nav : f.shell;
  return {
    '--bg-canvas': f.canvas,
    '--bg-app': f.canvas,
    '--bg-panel': f.panel,
    '--bg-elevated': f.panel,
    '--bg-shell': shell,
    '--bg-nav': f.nav,
    '--text-main': f.text,
    '--text-primary': f.text,
    '--text-muted': f.muted,
    '--text-nav': f.textNav,
    '--text-sidebar': f.textSidebar,
    '--text-sidebar-muted': f.muted,
    '--color-primary': f.primary,
    '--accent-hover': f.primaryHover,
    '--border': f.border,
    '--border-subtle': f.border,
    '--editor-bg': f.monacoBg,
    '--editor-accent': f.primary,
    '--agent-home-glow-primary': f.glowPrimary,
    '--agent-home-glow-secondary': f.glowSecondary,
  };
}

export function applyFieldsLive(fields: ThemeTweakFields): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(cssVarsFromFields(fields))) {
    root.style.setProperty(k, v);
  }
}

const THEME_DRAFT_LS_PREFIX = 'inneranimalmedia_theme_draft:user:';

function draftStorageKey(themeKey: string): string {
  const tk = themeKey.trim() || '__new__';
  return `${THEME_DRAFT_LS_PREFIX}${tk}`;
}

/** Debounced user-global live tweaks — survives refresh while editing and clears on Save. */
export function cacheThemeDraft(
  fields: ThemeTweakFields,
  themeKey?: string | null,
): void {
  const tk = themeKey?.trim() || fields.slug?.trim() || fields.name?.trim() || '__new__';
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      draftStorageKey(tk),
      JSON.stringify({ ...fields, theme_key: tk, updated_at: Date.now() }),
    );
  } catch {
    /* ignore quota */
  }
}

export function readThemeDraft(themeKey?: string | null): ThemeTweakFields | null {
  const tk = themeKey?.trim();
  if (!tk || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(draftStorageKey(tk));
    if (!raw?.trim()) return null;
    const parsed = JSON.parse(raw) as ThemeTweakFields & { updated_at?: number; theme_key?: string };
    if (!parsed || typeof parsed !== 'object') return null;
    const { updated_at: _u, theme_key: _k, ...fields } = parsed;
    return { ...DEFAULT_TWEAK_FIELDS, ...fields };
  } catch {
    return null;
  }
}

export function clearThemeDraft(themeKey?: string | null): void {
  const tk = themeKey?.trim();
  if (typeof localStorage === 'undefined') return;
  try {
    if (tk) {
      localStorage.removeItem(draftStorageKey(tk));
      return;
    }
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith(THEME_DRAFT_LS_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

/** Active-theme overlay: only restore a draft when it matches the resolved slug/id. */
export function readThemeDraftMatchingActive(
  activeThemeRef?: string | null,
): ThemeTweakFields | null {
  const ref = activeThemeRef?.trim();
  if (!ref) return null;
  return readThemeDraft(ref);
}

export function activePayloadFromFields(
  fields: ThemeTweakFields,
): import('../../src/applyCmsTheme').CmsActiveThemePayload {
  return {
    slug: fields.slug,
    name: fields.name,
    is_dark: fields.theme_family === 'dark',
    data: cssVarsFromFields(fields),
    theme_channel: 'live',
  };
}

export function updatePayloadFromFields(
  fields: ThemeTweakFields,
  opts: { theme_id?: string; create?: boolean } = {},
): Record<string, unknown> {
  const shell = fields.syncNavShell ? fields.nav : fields.shell;
  const previewUrl = fields.preview_image_url?.trim() || '';
  return {
    ...(opts.theme_id ? { theme_id: opts.theme_id } : {}),
    ...(opts.create
      ? { slug: fields.slug, name: fields.name, theme_family: fields.theme_family }
      : { theme_id: opts.theme_id }),
    name: fields.name,
    slug: fields.slug,
    theme_family: fields.theme_family,
    preview_image_url: previewUrl || null,
    sync_nav_shell: fields.syncNavShell,
    palette: {
      canvas: fields.canvas,
      surface: fields.panel,
      shell,
      nav: fields.nav,
      text: fields.text,
      textSecondary: fields.muted,
      border: fields.border,
      primary: fields.primary,
      primaryHover: fields.primaryHover,
      monacoBg: fields.monacoBg,
      is_dark: fields.theme_family === 'dark',
    },
    cssVars: cssVarsFromFields({ ...fields, shell }),
  };
}

export type CfImagePick = {
  id: string;
  url: string;
  name?: string;
  thumbnail_url?: string;
};

export type CfImageLibraryPage = {
  items: CfImagePick[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

export async function fetchCfImageLibrary(
  page = 1,
  perPage = 48,
  workspaceId?: string | null,
): Promise<CfImageLibraryPage> {
  const params = new URLSearchParams({
    source: 'cf_images',
    page: String(page),
    per_page: String(perPage),
  });
  const ws = workspaceId?.trim();
  if (ws) params.set('workspace_id', ws);

  const res = await fetch(`/api/images?${params.toString()}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    return { items: [], total: 0, page, perPage, totalPages: 0 };
  }
  const json = (await res.json()) as {
    images?: Array<{
      id?: string;
      url?: string;
      public_url?: string;
      name?: string;
      filename?: string;
      thumbnail_url?: string;
    }>;
    items?: Array<{
      id?: string;
      url?: string;
      public_url?: string;
      name?: string;
      filename?: string;
      thumbnail_url?: string;
    }>;
    total?: number;
    page?: number;
    per_page?: number;
  };
  const rows = json.images || json.items || [];
  const total = typeof json.total === 'number' ? json.total : rows.length;
  const resolvedPage = typeof json.page === 'number' ? json.page : page;
  const resolvedPerPage = typeof json.per_page === 'number' ? json.per_page : perPage;
  const items = rows
    .map((img) => ({
      id: String(img.id || ''),
      url: String(img.url || img.public_url || ''),
      name: img.name || img.filename,
      thumbnail_url: img.thumbnail_url,
    }))
    .filter((img) => img.url);
  return {
    items,
    total,
    page: resolvedPage,
    perPage: resolvedPerPage,
    totalPages: Math.max(1, Math.ceil(total / resolvedPerPage)),
  };
}
