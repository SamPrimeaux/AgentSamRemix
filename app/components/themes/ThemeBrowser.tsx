import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { dedupeThemeCatalog } from '../../src/themeCatalogDedup';
import { applyCmsThemeToDocument, type CmsActiveThemePayload } from '../../src/applyCmsTheme';
import { ThemePreviewCard, type CatalogTheme } from './ThemePreviewCard';
import { ThemeJsonInspector } from './ThemeJsonInspector';
import { ThemeTweaksPanel } from './ThemeTweaksPanel';

type ThemesApiResponse = { themes?: CatalogTheme[] };

function normalizeConfigRaw(theme: CatalogTheme & { config?: unknown }): string {
  const c = theme.config as unknown;
  if (typeof c === 'string') return c;
  if (c != null && typeof c === 'object') {
    try {
      return JSON.stringify(c);
    } catch {
      return '{}';
    }
  }
  return '{}';
}

export function ThemeBrowser(): React.ReactElement {
  const [themes, setThemes] = useState<CatalogTheme[]>([]);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'compact'>('grid');
  const [inspectTheme, setInspectTheme] = useState<CatalogTheme | null>(null);
  const [editTheme, setEditTheme] = useState<CatalogTheme | null>(null);
  const [createTheme, setCreateTheme] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, activeRes] = await Promise.all([
        fetch('/api/themes', { credentials: 'include' }),
        fetch('/api/themes/active', { credentials: 'include' }),
      ]);
      const listJson = (await listRes.json()) as ThemesApiResponse;
      const list = listJson.themes;
      if (Array.isArray(list)) {
        setThemes(list as CatalogTheme[]);
      }
      if (activeRes.ok) {
        const a = (await activeRes.json()) as { slug?: string };
        if (a.slug) setActiveSlug(String(a.slug));
      }
    } catch (e) {
      console.error(e);
      setStatusMsg('Could not load themes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return themes;
    return themes.filter((t) => {
      const blob = `${t.name} ${t.slug} ${t.theme_family} ${t.status ?? ''}`.toLowerCase();
      return blob.includes(q);
    });
  }, [themes, query]);

  const [hideDuplicates, setHideDuplicates] = useState(true);
  const [archivingDupes, setArchivingDupes] = useState(false);

  const deduped = useMemo(
    () => dedupeThemeCatalog(filtered, activeSlug),
    [filtered, activeSlug],
  );

  const displayThemes = hideDuplicates ? deduped.uniqueThemes : filtered;
  const archivableDuplicateThemes = useMemo(
    () => deduped.duplicateThemes.filter((theme) => !theme.is_system && !!theme.tenant_id),
    [deduped.duplicateThemes],
  );

  const archiveDuplicateThemes = useCallback(async () => {
    if (!archivableDuplicateThemes.length) return;
    if (!window.confirm(`Archive ${archivableDuplicateThemes.length} editable duplicate themes?`)) return;
    setArchivingDupes(true);
    setStatusMsg('Archiving duplicates…');
    try {
      let archived = 0;
      for (const theme of archivableDuplicateThemes) {
        if (!theme.id) continue;
        const res = await fetch('/api/themes/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ theme_id: theme.id }),
        });
        if (res.ok) archived += 1;
      }
      await loadAll();
      setStatusMsg(archived ? `Archived ${archived} duplicate theme(s).` : 'No duplicates archived.');
    } catch {
      setStatusMsg('Archive duplicates failed.');
    } finally {
      setArchivingDupes(false);
    }
  }, [archivableDuplicateThemes, loadAll]);

  const applyTheme = useCallback(
    async (theme: CatalogTheme) => {
      const preview = await fetch('/api/themes/active', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      const raw = normalizeConfigRaw(theme);
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const vars = parsed.cssVars as Record<string, string> | undefined;
        const root = document.documentElement;
        if (vars && typeof vars === 'object') {
          Object.entries(vars).forEach(([k, v]) => {
            if (typeof v === 'string') root.style.setProperty(k, v);
          });
        } else {
          Object.entries(parsed).forEach(([k, v]) => {
            if (k.startsWith('--') && typeof v === 'string') root.style.setProperty(k, v);
          });
        }
      } catch {
        /* optimistic apply skipped */
      }

      const res = await fetch('/api/themes/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          theme_id: theme.id,
          scope: 'user_global',
        }),
      });

      if (!res.ok && preview?.data && typeof preview.data === 'object') {
        applyCmsThemeToDocument(preview as CmsActiveThemePayload);
        setStatusMsg('Apply failed — restored previous theme.');
        return;
      }

      const payload = (await res.json().catch(() => null)) as CmsActiveThemePayload | null;
      const data = payload?.data;
      if (
        payload &&
        data != null &&
        typeof data === 'object' &&
        !Array.isArray(data) &&
        Object.keys(data as object).length > 0
      ) {
        applyCmsThemeToDocument(payload);
        try {
          window.dispatchEvent(new CustomEvent('iam:invalidate-active-theme-fetch'));
        } catch {
          /* ignore */
        }
      }

      await loadAll();
      setActiveSlug(theme.slug);
      setStatusMsg(null);
    },
    [loadAll],
  );

  const previewLocal = useCallback((theme: CatalogTheme) => {
    const pm = theme.preview_model;
    if (!pm) return;
    const w = window.open('', '_blank');
    if (!w) return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${theme.slug}</title></head><body style="margin:0;background:${pm.canvas};font-family:system-ui"><div style="padding:16px;color:${pm.text}"><strong>${theme.name}</strong><pre style="font-size:11px">${JSON.stringify(pm, null, 2)}</pre></div></body></html>`;
    w.document.write(html);
    w.document.close();
  }, []);

  const openPackage = useCallback((theme: CatalogTheme) => {
    const url = `https://assets.inneranimalmedia.com/cms/themes/${encodeURIComponent(theme.slug)}/manifest.json`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const closePanel = useCallback(() => {
    setEditTheme(null);
    setCreateTheme(false);
    void loadAll();
    void fetch('/api/themes/active', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (p?.data) applyCmsThemeToDocument(p as CmsActiveThemePayload);
      })
      .catch(() => {});
  }, [loadAll]);

  const openTheme = useCallback((theme: CatalogTheme) => {
    setEditTheme(theme);
    setCreateTheme(false);
  }, []);

  const handleThemeSaved = useCallback(
    async (savedTheme?: CatalogTheme) => {
      await loadAll();
      if (savedTheme?.id) {
        setEditTheme(savedTheme);
        return;
      }
      setEditTheme((prev) => {
        if (!prev?.id) return prev;
        return themes.find((t) => t.id === prev.id) ?? prev;
      });
    },
    [loadAll, themes],
  );

  const panelOpen = editTheme != null || createTheme;

  const regenerate = useCallback(
    async (theme: CatalogTheme) => {
      setStatusMsg('Regenerating package…');
      try {
        const res = await fetch('/api/themes/package', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            theme_id: theme.id,
            slug: theme.slug,
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setStatusMsg(typeof json?.error === 'string' ? json.error : 'Regenerate failed');
          return;
        }
        await loadAll();
        setStatusMsg('Package regenerated.');
      } catch {
        setStatusMsg('Regenerate failed');
      }
    },
    [loadAll],
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <h3 className="text-sm font-medium text-main uppercase tracking-wider">Themes</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Search name, slug, family…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="text-xs rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] px-3 py-1.5 min-w-[200px] text-main"
          />
          <div className="flex rounded-lg border border-[var(--dashboard-border)] overflow-hidden">
            <button
              type="button"
              className={`text-xs px-3 py-1.5 ${view === 'grid' ? 'bg-[var(--bg-hover)]' : ''}`}
              onClick={() => setView('grid')}
            >
              Grid
            </button>
            <button
              type="button"
              className={`text-xs px-3 py-1.5 ${view === 'compact' ? 'bg-[var(--bg-hover)]' : ''}`}
              onClick={() => setView('compact')}
            >
              List
            </button>
          </div>
          <button
            type="button"
            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--dashboard-border)] bg-[var(--color-primary)] text-white"
            onClick={() => {
              setCreateTheme(true);
              setEditTheme(null);
            }}
          >
            New theme
          </button>
          <button
            type="button"
            className="text-xs px-3 py-1.5 rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)]"
            onClick={() => void loadAll()}
          >
            Refresh
          </button>
          <label className="flex items-center gap-1.5 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={hideDuplicates}
              onChange={(e) => setHideDuplicates(e.target.checked)}
            />
            Hide duplicates
          </label>
          {archivableDuplicateThemes.length > 0 ? (
            <button
              type="button"
              disabled={archivingDupes}
              className="text-xs px-3 py-1.5 rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] disabled:opacity-50"
              onClick={() => void archiveDuplicateThemes()}
            >
              {archivingDupes ? 'Archiving…' : `Archive ${archivableDuplicateThemes.length} duplicates`}
            </button>
          ) : null}
        </div>
      </div>

      {statusMsg ? <p className="text-xs text-muted">{statusMsg}</p> : null}
      {hideDuplicates && deduped.duplicateCount > 0 ? (
        <p className="text-[11px] text-muted">
          Showing {displayThemes.length} unique palettes ({deduped.duplicateCount} near-identical themes hidden).
        </p>
      ) : null}

      {loading ? (
        <p className="text-xs text-muted">Loading themes…</p>
      ) : (
        <div className="relative min-h-0">
          <div
            className={
              view === 'grid'
                ? `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 ${panelOpen ? 'xl:grid-cols-2' : 'xl:grid-cols-3'} gap-4`
                : 'flex flex-col gap-2'
            }
          >
            {displayThemes.map((theme) => (
              <ThemePreviewCard
                key={theme.id}
                theme={theme}
                active={activeSlug === theme.slug}
                selected={editTheme?.id === theme.id}
                compact={view === 'compact'}
                onOpen={openTheme}
                onApply={(t) => void applyTheme(t)}
                onEdit={openTheme}
                onPreviewLocal={previewLocal}
                onInspect={setInspectTheme}
                onOpenPackage={openPackage}
                onRegenerate={(t) => void regenerate(t)}
              />
            ))}
          </div>

          {panelOpen && typeof document !== 'undefined'
            ? createPortal(
                // One fixed root so iOS hit-tests backdrop + panel in the same stacking
                // context (sibling fixed layers still ate bottom-of-screen Save taps).
                <div className="fixed inset-0 z-[280] flex justify-end" role="presentation">
                  <button
                    type="button"
                    aria-label="Close theme editor"
                    className="absolute inset-0 bg-[var(--text-main)]/40 xl:hidden"
                    onClick={closePanel}
                  />
                  <div
                    className="relative z-[1] h-[100dvh] max-h-[100dvh] w-full max-w-[420px] flex flex-col overflow-hidden pointer-events-auto sm:h-auto sm:max-h-[calc(100dvh-1.5rem)] sm:my-3 sm:mr-3 sm:rounded-xl"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Theme editor"
                    style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ThemeTweaksPanel
                      theme={editTheme}
                      createMode={createTheme}
                      className="h-full min-h-0 shadow-2xl xl:shadow-none max-phone:rounded-none"
                      onClose={closePanel}
                      onSaved={(saved) => void handleThemeSaved(saved)}
                      onDeleted={() => {
                        setEditTheme(null);
                        void loadAll();
                      }}
                    />
                  </div>
                </div>,
                document.body,
              )
            : null}
        </div>
      )}

      <ThemeJsonInspector
        open={inspectTheme != null}
        title={inspectTheme ? `Theme: ${inspectTheme.slug}` : ''}
        data={
          inspectTheme
            ? {
                row: inspectTheme,
                preview_model: inspectTheme.preview_model,
                parsed: (inspectTheme as { parsed?: unknown }).parsed,
                parse_errors: (inspectTheme as { parse_errors?: unknown }).parse_errors,
              }
            : null
        }
        onClose={() => setInspectTheme(null)}
      />
    </div>
  );
}
