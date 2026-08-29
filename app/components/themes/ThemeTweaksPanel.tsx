import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { applyCmsThemeToDocument, type CmsActiveThemePayload } from '../../src/applyCmsTheme';
import { ThemePreviewCanvas } from './ThemePreviewCanvas';
import type { CatalogTheme } from './ThemePreviewCard';

import {
  applyFieldsLive,
  activePayloadFromFields,
  cacheThemeDraft,
  clearThemeDraft,
  DEFAULT_TWEAK_FIELDS,
  fieldsFromTheme,
  readThemeDraft,
  type ThemeTweakFields,
  updatePayloadFromFields,
} from './themeTweaksModel';

export type ThemeTweaksPanelProps = {
  theme: CatalogTheme | null;
  createMode?: boolean;
  onClose: () => void;
  onSaved: (savedTheme?: CatalogTheme) => void;
  onDeleted?: () => void;
  className?: string;
};

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'color';
}) {
  return (
    <label className="grid gap-1 text-[11px]">
      <span className="text-muted uppercase tracking-wide">{label}</span>
      <div className="flex gap-2 items-center">
        {type === 'color' ? (
          <input
            type="color"
            value={value.startsWith('#') && value.length >= 7 ? value.slice(0, 7) : '#2563EB'}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-10 rounded border border-[var(--dashboard-border)] bg-transparent cursor-pointer shrink-0"
          />
        ) : null}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 rounded-md border border-[var(--dashboard-border)] bg-[var(--dashboard-canvas)] px-2 py-1.5 text-[16px] sm:text-[12px] text-main font-mono"
        />
      </div>
    </label>
  );
}

export function ThemeTweaksPanel({
  theme,
  createMode = false,
  onClose,
  onSaved,
  onDeleted,
  className = '',
}: ThemeTweaksPanelProps): React.ReactElement {
  const [fields, setFields] = useState<ThemeTweakFields>(() =>
    createMode ? { ...DEFAULT_TWEAK_FIELDS } : fieldsFromTheme(theme),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const themeDraftKey = createMode ? '__new__' : theme?.id || theme?.slug || '';

  useEffect(() => {
    if (createMode) {
      setFields({ ...DEFAULT_TWEAK_FIELDS, slug: `theme-${Date.now().toString(36).slice(-6)}` });
    } else if (themeDraftKey) {
      const draft = readThemeDraft(themeDraftKey);
      setFields(draft ?? fieldsFromTheme(theme));
    } else {
      setFields(fieldsFromTheme(theme));
    }
    setMsg(null);
  }, [theme, createMode, themeDraftKey]);

  useEffect(() => {
    applyFieldsLive(fields);
    if (!themeDraftKey) return;
    const timer = window.setTimeout(() => {
      cacheThemeDraft(fields, themeDraftKey);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [fields, themeDraftKey]);

  const previewModel = useMemo(
    () => ({
      canvas: fields.canvas,
      panel: fields.panel,
      nav: fields.nav,
      shell: fields.syncNavShell ? fields.nav : fields.shell,
      text: fields.text,
      primary: fields.primary,
      monacoBg: fields.monacoBg,
      monacoText: fields.text,
    }),
    [fields],
  );

  const patchField = useCallback((key: keyof ThemeTweakFields, value: string | boolean) => {
    setFields((prev) => {
      const next = { ...prev, [key]: value } as ThemeTweakFields;
      if (key === 'nav' && next.syncNavShell) next.shell = String(value);
      if (key === 'shell' && next.syncNavShell) next.nav = String(value);
      return next;
    });
  }, []);

  const save = useCallback(
    async (applyAfter = false) => {
      setBusy(true);
      setMsg(null);
      try {
        const endpoint = createMode ? '/api/themes/create' : '/api/themes/update';
        const body = createMode
          ? {
              ...updatePayloadFromFields(fields, { create: true }),
              apply_to_user: applyAfter,
            }
          : {
              theme_id: theme?.id,
              ...updatePayloadFromFields(fields, { theme_id: theme?.id }),
              apply_to_user: applyAfter,
              preview_live: applyAfter,
            };

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => null)) as {
          error?: string;
          active_theme?: CmsActiveThemePayload;
          theme?: CatalogTheme;
        };
        if (!res.ok) {
          setMsg(json?.error || 'Save failed');
          return;
        }
        if (json?.active_theme) {
          applyCmsThemeToDocument(json.active_theme);
          window.dispatchEvent(new CustomEvent('iam:invalidate-active-theme-fetch'));
        } else if (applyAfter) {
          applyCmsThemeToDocument(activePayloadFromFields(fields));
        }
        clearThemeDraft(themeDraftKey);
        setMsg(createMode ? 'Theme created.' : applyAfter ? 'Saved and applied.' : 'Saved.');
        onSaved(json?.theme ?? undefined);
      } catch {
        setMsg('Save failed');
      } finally {
        setBusy(false);
      }
    },
    [fields, createMode, theme?.id, themeDraftKey, onSaved],
  );

  const remove = useCallback(async () => {
    if (!theme?.id || createMode) return;
    if (!window.confirm(`Archive theme "${theme.name}"?`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/themes/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ theme_id: theme.id }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string };
        setMsg(json?.error || 'Delete failed');
        return;
      }
      onDeleted?.();
      onClose();
    } finally {
      setBusy(false);
    }
  }, [theme, createMode, onDeleted, onClose]);

  return (
    <>
      <aside
        className={`rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] flex flex-col min-h-0 overflow-hidden h-full max-h-[inherit] ${className}`}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--dashboard-border)] shrink-0">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-main truncate">
              {createMode ? 'New theme' : theme?.name || 'Theme tweaks'}
            </h4>
            <p className="text-[11px] text-muted">Live preview · draft saved locally until Save</p>
            {!createMode && theme && (theme.is_system || !theme.tenant_id) ? (
              <p className="text-[10px] text-muted mt-1">Shared template · Save creates your editable copy.</p>
            ) : null}
          </div>
          <button
            type="button"
            className="text-xs shrink-0 px-2 py-1 rounded-md text-muted hover:text-main hover:bg-[var(--bg-hover)]"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain p-4 space-y-5 custom-scrollbar [-webkit-overflow-scrolling:touch]">
          <section className="space-y-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Live preview
            </span>
            <div aria-live="polite" aria-label="Current theme preview">
              <ThemePreviewCanvas model={previewModel} height={144} />
            </div>
          </section>

          <section className="space-y-3">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Identity
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name" value={fields.name} onChange={(v) => patchField('name', v)} />
              <Field label="Slug" value={fields.slug} onChange={(v) => patchField('slug', v)} />
            </div>
            <label className="grid gap-1 text-[11px]">
              <span className="text-muted uppercase tracking-wide">Family</span>
              <select
                value={fields.theme_family}
                onChange={(e) => patchField('theme_family', e.target.value)}
                className="rounded-md border border-[var(--dashboard-border)] bg-[var(--dashboard-canvas)] px-2 py-1.5 text-[16px] sm:text-[12px]"
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                Colors
              </span>
              <label className="flex items-center gap-2 text-[11px] text-muted">
                <input
                  type="checkbox"
                  checked={fields.syncNavShell}
                  onChange={(e) => patchField('syncNavShell', e.target.checked)}
                />
                Sync nav + sidebar
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Canvas" value={fields.canvas} onChange={(v) => patchField('canvas', v)} type="color" />
              <Field label="Panel" value={fields.panel} onChange={(v) => patchField('panel', v)} type="color" />
              <Field label="Top nav" value={fields.nav} onChange={(v) => patchField('nav', v)} type="color" />
              {!fields.syncNavShell ? (
                <Field label="Sidebar" value={fields.shell} onChange={(v) => patchField('shell', v)} type="color" />
              ) : null}
              <Field label="Primary" value={fields.primary} onChange={(v) => patchField('primary', v)} type="color" />
              <Field
                label="Primary hover"
                value={fields.primaryHover}
                onChange={(v) => patchField('primaryHover', v)}
                type="color"
              />
              <Field label="Text" value={fields.text} onChange={(v) => patchField('text', v)} type="color" />
              <Field label="Muted" value={fields.muted} onChange={(v) => patchField('muted', v)} type="color" />
              <Field label="Nav text" value={fields.textNav} onChange={(v) => patchField('textNav', v)} type="color" />
              <Field
                label="Sidebar text"
                value={fields.textSidebar}
                onChange={(v) => patchField('textSidebar', v)}
                type="color"
              />
              <Field label="Border" value={fields.border} onChange={(v) => patchField('border', v)} type="color" />
              <Field label="Monaco bg" value={fields.monacoBg} onChange={(v) => patchField('monacoBg', v)} type="color" />
            </div>
          </section>

          {/* Spacer so last color fields clear the sticky action bar while scrolling */}
          <div className="h-2 shrink-0" aria-hidden />
        </div>

        <div
          className="relative z-20 isolate shrink-0 border-t border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] pointer-events-auto"
          style={{
            // Home-indicator dead zone still steals taps when safe-area resolves to 0
            // (missing viewport-fit=cover) — keep a phone-floor pad either way.
            paddingBottom:
              'max(1.25rem, calc(env(safe-area-inset-bottom, 0px) + 0.75rem))',
          }}
        >
          {msg ? (
            <p className="px-4 pt-2 text-[12px] text-muted" role="status">
              {msg}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
            <button
              type="button"
              disabled={busy}
              className="relative z-10 min-h-12 min-w-[4.5rem] touch-manipulation select-none text-[14px] px-4 py-3 rounded-md border border-[var(--dashboard-border)] text-main font-medium disabled:opacity-50 cursor-pointer"
              onClick={() => void save(false)}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              disabled={busy}
              className="relative z-10 min-h-12 touch-manipulation select-none text-[14px] px-4 py-3 rounded-md bg-[var(--color-primary)] text-white font-medium disabled:opacity-50 cursor-pointer"
              onClick={() => void save(true)}
            >
              {busy ? 'Saving…' : 'Save & apply'}
            </button>
            {!createMode && theme && !theme.is_system && !!theme.tenant_id ? (
              <button
                type="button"
                disabled={busy}
                className="relative z-10 min-h-12 touch-manipulation select-none text-[14px] px-4 py-3 rounded-md border border-red-500/40 text-red-400 ml-auto disabled:opacity-50 cursor-pointer"
                onClick={() => void remove()}
              >
                Delete
              </button>
            ) : null}
          </div>
        </div>
      </aside>

    </>
  );
}
