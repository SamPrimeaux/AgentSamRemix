import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsUpDown, Check, Plus } from 'lucide-react';
import type { CmsWorkspaceSite } from '../../hooks/useCmsWorkspaceContext';

type Props = {
  sites: CmsWorkspaceSite[];
  activeSlug?: string | null;
  onSelect: (slug: string) => void | Promise<void>;
  onNewSite?: () => void;
  disabled?: boolean;
  /** Compact for toolbars; default is hero-sized. */
  size?: 'sm' | 'md';
  className?: string;
};

function sortSites(sites: CmsWorkspaceSite[]): CmsWorkspaceSite[] {
  return [...sites].sort((a, b) => {
    const priA = Number(a.hub_priority) || 0;
    const priB = Number(b.hub_priority) || 0;
    if (priA !== priB) return priB - priA;
    const fa = a.is_featured ? 1 : 0;
    const fb = b.is_featured ? 1 : 0;
    if (fa !== fb) return fb - fa;
    return String(a.name || a.slug).localeCompare(String(b.name || b.slug));
  });
}

function siteLabel(site: CmsWorkspaceSite): string {
  return (site.name || site.slug || 'Site').trim();
}

function siteHint(site: CmsWorkspaceSite): string {
  const domain = site.domain?.trim();
  if (domain) return domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return site.slug;
}

/**
 * Always-visible site picker for the CMS command center / shell.
 * Works with 1+ registered sites (Companions, Fuel, IAM, etc.).
 */
export function CmsSiteSwitcher({
  sites,
  activeSlug,
  onSelect,
  onNewSite,
  disabled = false,
  size = 'md',
  className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => sortSites(sites), [sites]);
  const active = rows.find((s) => s.slug === activeSlug) || null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!rows.length) {
    return (
      <div className={`iam-cms-site-switcher iam-cms-site-switcher--empty ${className}`.trim()}>
        <button
          type="button"
          className={`iam-cms-site-switcher__trigger size-${size}`}
          disabled={disabled || !onNewSite}
          onClick={() => onNewSite?.()}
        >
          <span className="iam-cms-site-switcher__copy">
            <span className="iam-cms-site-switcher__label">No sites yet</span>
            <span className="iam-cms-site-switcher__hint">Deploy a CMS site to get started</span>
          </span>
          {onNewSite ? <Plus size={16} aria-hidden /> : null}
        </button>
      </div>
    );
  }

  const triggerName = active ? siteLabel(active) : 'Select a site';
  const triggerHint = active ? siteHint(active) : `${rows.length} site${rows.length === 1 ? '' : 's'} available`;

  return (
    <div
      className={`iam-cms-site-switcher ${open ? 'is-open' : ''} ${className}`.trim()}
      ref={rootRef}
    >
      <button
        type="button"
        className={`iam-cms-site-switcher__trigger size-${size}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Switch CMS site"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="iam-cms-site-switcher__copy">
          <span className="iam-cms-site-switcher__eyebrow">Working on</span>
          <span className="iam-cms-site-switcher__label">{triggerName}</span>
          <span className="iam-cms-site-switcher__hint">{triggerHint}</span>
        </span>
        <ChevronsUpDown size={16} strokeWidth={2} aria-hidden />
      </button>

      {open ? (
        <div className="iam-cms-site-switcher__menu" role="listbox" aria-label="CMS sites">
          {rows.map((row) => {
            const selected = row.slug === activeSlug;
            return (
              <button
                key={row.slug}
                type="button"
                role="option"
                aria-selected={selected}
                className={`iam-cms-site-switcher__option${selected ? ' is-active' : ''}`}
                onClick={() => {
                  setOpen(false);
                  if (!selected) void onSelect(row.slug);
                }}
              >
                <span className="iam-cms-site-switcher__option-copy">
                  <span className="iam-cms-site-switcher__option-name">{siteLabel(row)}</span>
                  <span className="iam-cms-site-switcher__option-hint">{siteHint(row)}</span>
                </span>
                {selected ? <Check size={14} strokeWidth={2.25} aria-hidden /> : null}
              </button>
            );
          })}
          {onNewSite ? (
            <button
              type="button"
              className="iam-cms-site-switcher__option iam-cms-site-switcher__option--new"
              onClick={() => {
                setOpen(false);
                onNewSite();
              }}
            >
              <Plus size={14} aria-hidden />
              New site
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default CmsSiteSwitcher;
