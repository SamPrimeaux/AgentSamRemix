import React, { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { ThemePreviewCanvas, type PreviewModel } from './ThemePreviewCanvas';
import { ThemeSwatches } from './ThemeSwatches';

export type CatalogTheme = {
  id: string;
  name: string;
  slug: string;
  theme_family: string;
  status?: string | null;
  tenant_id?: string | null;
  workspace_id?: string | null;
  is_system?: boolean | number;
  alias_of_theme_id?: string | null;
  preview_image_url?: string | null;
  css_url?: string | null;
  preview_model?: PreviewModel;
  config?: unknown;
  parsed?: unknown;
  parse_errors?: Record<string, string | null | undefined>;
};

export type ThemePreviewCardProps = {
  theme: CatalogTheme;
  active: boolean;
  selected?: boolean;
  compact?: boolean;
  onOpen: (t: CatalogTheme) => void;
  onApply: (t: CatalogTheme) => void;
  onEdit: (t: CatalogTheme) => void;
  onPreviewLocal: (t: CatalogTheme) => void;
  onInspect: (t: CatalogTheme) => void;
  onOpenPackage: (t: CatalogTheme) => void;
  onRegenerate: (t: CatalogTheme) => void;
};

export function ThemePreviewCard({
  theme,
  active,
  selected = false,
  compact,
  onOpen,
  onApply,
  onEdit,
  onPreviewLocal,
  onInspect,
  onOpenPackage,
  onRegenerate,
}: ThemePreviewCardProps): React.ReactElement {
  const pm = theme.preview_model || {};
  const swatches = pm.swatches?.length
    ? pm.swatches
    : ([pm.canvas, pm.primary, pm.monacoBg, pm.nav].filter(Boolean) as string[]);

  const previewVisual = <ThemePreviewCanvas model={pm} height={compact ? 52 : 112} />;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(theme);
    }
  };

  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Open theme ${theme.name}`}
      onClick={() => onOpen(theme)}
      onKeyDown={handleKeyDown}
      className={`relative rounded-xl border transition-all flex flex-col overflow-hidden cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--solar-cyan)] ${
        selected
          ? 'border-[var(--solar-cyan)] ring-2 ring-[var(--solar-cyan)]/40 bg-[var(--bg-hover)] shadow-md'
          : active
            ? 'border-[var(--solar-cyan)] ring-1 ring-[var(--solar-cyan)]/35 bg-[var(--bg-hover)]'
            : 'border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] hover:bg-[var(--bg-hover)] hover:border-[var(--solar-cyan)]/50'
      }`}
    >
      <div className={compact ? 'p-2 gap-3 flex flex-row items-stretch' : 'p-3 gap-3 flex flex-col'}>
        <div className={compact ? 'w-[120px] shrink-0' : ''}>{previewVisual}</div>

        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-semibold text-main truncate">{theme.name}</h4>
                {active ? (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--solar-cyan)]/15 text-[var(--solar-cyan)]">
                    Active
                  </span>
                ) : null}
                {selected ? (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
                    Editing
                  </span>
                ) : null}
              </div>
              <p className="text-[11px] text-muted font-mono truncate">{theme.slug}</p>
              <p className="text-[11px] text-muted mt-0.5">
                {theme.theme_family}
                {theme.status ? ` · ${theme.status}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap mt-1">
            <ThemeSwatches colors={swatches} />
            <span
              className="text-[10px] px-1.5 py-0.5 rounded border border-black/10 font-mono"
              style={{
                background: pm.monacoBg || '#1e293b',
                color: pm.monacoText || '#e2e8f0',
              }}
              title="Monaco bg"
            >
              ●
            </span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded text-white font-medium"
              style={{ background: pm.primary || '#0ea5e9' }}
              title="Primary"
            >
              Aa
            </span>
          </div>

          {/* Primary actions only — Tweaks/Apply are the 95% case. Everything
              else (preview/inspect/package/regenerate) was wrapping onto a
              second row per card; it now lives behind one overflow menu. */}
          <div
            className="flex items-center gap-1.5 mt-2"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="text-[11px] px-2 py-1 rounded-md bg-[var(--color-primary)] text-white font-medium"
              onClick={() => onEdit(theme)}
            >
              Tweaks
            </button>
            <button
              type="button"
              className="text-[11px] px-2 py-1 rounded-md bg-[var(--color-primary)]/90 text-white font-medium"
              onClick={() => onApply(theme)}
            >
              Apply
            </button>
            <div className="relative ml-auto">
              <button
                type="button"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                className="p-1.5 rounded-md text-muted hover:text-main hover:bg-[var(--bg-hover)] border border-[var(--dashboard-border)]"
                onClick={() => setMoreOpen((o) => !o)}
              >
                <MoreHorizontal size={14} />
              </button>
              {moreOpen ? (
                <>
                  <button
                    type="button"
                    aria-label="Close menu"
                    className="fixed inset-0 z-10 cursor-default"
                    onClick={() => setMoreOpen(false)}
                  />
                  <div
                    role="menu"
                    className="absolute right-0 top-full mt-1 z-20 min-w-[160px] rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] shadow-lg py-1 flex flex-col"
                  >
                    {[
                      { label: 'Preview locally', onClick: onPreviewLocal },
                      { label: 'Inspect JSON', onClick: onInspect },
                      { label: 'Open R2 package', onClick: onOpenPackage },
                      ...(!theme.is_system && theme.tenant_id
                        ? [{ label: 'Regenerate', onClick: onRegenerate }]
                        : []),
                    ].map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        role="menuitem"
                        className="text-left text-[11px] px-3 py-1.5 text-main hover:bg-[var(--bg-hover)]"
                        onClick={() => {
                          setMoreOpen(false);
                          item.onClick(theme);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
