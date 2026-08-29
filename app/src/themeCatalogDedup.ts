import type { CatalogTheme } from '../components/themes/ThemePreviewCard';

const FINGERPRINT_KEYS = [
  '--bg-canvas',
  '--bg-app',
  '--bg-panel',
  '--bg-nav',
  '--bg-shell',
  '--color-primary',
  '--text-main',
  '--text-muted',
  '--border',
] as const;

export function themeVisualFingerprint(theme: CatalogTheme): string {
  const parsed = (theme as { parsed?: { cssVarsMerged?: Record<string, string> } }).parsed;
  const cv = parsed?.cssVarsMerged || {};
  const cfg = (theme as { config?: Record<string, unknown> }).config;
  let configVars: Record<string, string> = {};
  if (typeof cfg === 'string') {
    try {
      const p = JSON.parse(cfg) as { cssVars?: Record<string, string> };
      configVars = p?.cssVars || {};
    } catch {
      /* ignore */
    }
  } else if (cfg && typeof cfg === 'object' && cfg.cssVars && typeof cfg.cssVars === 'object') {
    configVars = cfg.cssVars as Record<string, string>;
  }
  return FINGERPRINT_KEYS.map((k) => String(cv[k] ?? configVars[k] ?? '').trim().toLowerCase()).join('|');
}

export type ThemeDedupeResult = {
  /** One canonical theme per visual fingerprint (prefers active slug, then oldest). */
  uniqueThemes: CatalogTheme[];
  /** Extra themes that match a canonical palette. */
  duplicateThemes: CatalogTheme[];
  duplicateCount: number;
};

export function dedupeThemeCatalog(themes: CatalogTheme[], activeSlug?: string | null): ThemeDedupeResult {
  const groups = new Map<string, CatalogTheme[]>();
  for (const theme of themes) {
    const fp = themeVisualFingerprint(theme);
    const list = groups.get(fp) || [];
    list.push(theme);
    groups.set(fp, list);
  }

  const uniqueThemes: CatalogTheme[] = [];
  const duplicateThemes: CatalogTheme[] = [];
  const active = activeSlug?.trim() || '';

  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => {
      if (active) {
        if (a.slug === active) return -1;
        if (b.slug === active) return 1;
      }
      const aEditable = Boolean(a.tenant_id && !a.is_system);
      const bEditable = Boolean(b.tenant_id && !b.is_system);
      if (aEditable !== bEditable) return aEditable ? -1 : 1;
      const ta = Number(a.created_at || 0);
      const tb = Number(b.created_at || 0);
      if (ta && tb && ta !== tb) return ta - tb;
      return String(a.slug).localeCompare(String(b.slug));
    });
    uniqueThemes.push(sorted[0]);
    if (sorted.length > 1) duplicateThemes.push(...sorted.slice(1));
  }

  uniqueThemes.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  return {
    uniqueThemes,
    duplicateThemes,
    duplicateCount: duplicateThemes.length,
  };
}
