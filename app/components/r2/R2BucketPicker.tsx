import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';

export const R2_BUCKET_PICKER_PAGE_SIZE = 12;

export type R2BucketPickerProps = {
  buckets: string[];
  value: string;
  onChange: (bucket: string) => void;
  /** Results per page. Default 12 (CF R2 picker density). */
  pageSize?: number;
  placeholder?: string;
  disabled?: boolean;
  /** Stretch trigger to full width (sidebar). */
  fullWidth?: boolean;
  id?: string;
  'aria-label'?: string;
};

function filterBuckets(buckets: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return buckets;
  return buckets.filter((b) => b.toLowerCase().includes(q));
}

/**
 * Searchable, paginated R2 bucket picker (CF dashboard R2 palette pattern).
 * Type-to-filter · ↑↓ navigate · ↵ select · 12/page with &lt; &gt; controls.
 */
export function R2BucketPicker({
  buckets,
  value,
  onChange,
  pageSize = R2_BUCKET_PICKER_PAGE_SIZE,
  placeholder = 'Select R2 bucket…',
  disabled = false,
  fullWidth = false,
  id,
  'aria-label': ariaLabel = 'Select R2 bucket',
}: R2BucketPickerProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [highlight, setHighlight] = useState(0);

  const filtered = useMemo(() => filterBuckets(buckets, query), [buckets, query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage, pageSize]);

  useEffect(() => {
    setPage(1);
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (pageItems.length === 0) {
      if (highlight !== 0) setHighlight(0);
      return;
    }
    if (highlight >= pageItems.length) setHighlight(pageItems.length - 1);
  }, [pageItems.length, highlight]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selectBucket = useCallback(
    (name: string) => {
      onChange(name);
      setOpen(false);
      setQuery('');
      setPage(1);
      setHighlight(0);
    },
    [onChange],
  );

  const moveHighlight = useCallback(
    (delta: number) => {
      if (!pageItems.length) return;
      setHighlight((h) => {
        const next = (h + delta + pageItems.length) % pageItems.length;
        return next;
      });
    },
    [pageItems.length],
  );

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (highlight >= pageItems.length - 1 && safePage < totalPages) {
        setPage((p) => p + 1);
        setHighlight(0);
      } else {
        moveHighlight(1);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (highlight <= 0 && safePage > 1) {
        setPage((p) => p - 1);
        setHighlight(pageSize - 1);
      } else {
        moveHighlight(-1);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = pageItems[highlight];
      if (pick) selectBucket(pick);
      return;
    }
    if (e.key === 'PageDown') {
      e.preventDefault();
      if (safePage < totalPages) {
        setPage((p) => p + 1);
        setHighlight(0);
      }
      return;
    }
    if (e.key === 'PageUp') {
      e.preventDefault();
      if (safePage > 1) {
        setPage((p) => p - 1);
        setHighlight(0);
      }
    }
  };

  const triggerLabel = value
    ? value
    : buckets.length
      ? `${placeholder} (${buckets.length})`
      : placeholder;

  return (
    <div
      ref={rootRef}
      style={{ position: 'relative', width: fullWidth ? '100%' : undefined, fontFamily: 'inherit' }}
    >
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onTriggerKeyDown}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          width: fullWidth ? '100%' : undefined,
          minWidth: fullWidth ? undefined : 200,
          maxWidth: fullWidth ? undefined : 320,
          fontSize: 12,
          padding: '5px 8px',
          borderRadius: 8,
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-elevated)',
          color: value ? 'var(--text-main)' : 'var(--text-muted)',
          fontFamily: 'inherit',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          textAlign: 'left',
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {triggerLabel}
        </span>
        <ChevronDown
          size={14}
          style={{
            flexShrink: 0,
            color: 'var(--text-muted)',
            transform: open ? 'rotate(180deg)' : undefined,
            transition: 'transform 120ms ease',
          }}
        />
      </button>

      {open ? (
        <div
          role="presentation"
          onKeyDown={onPanelKeyDown}
          style={{
            position: 'absolute',
            zIndex: 60,
            top: 'calc(100% + 4px)',
            left: 0,
            width: fullWidth ? '100%' : 320,
            minWidth: fullWidth ? undefined : 280,
            borderRadius: 10,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-panel)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
            overflow: 'hidden',
            fontFamily: 'inherit',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter buckets…"
              aria-label="Filter R2 buckets"
              autoComplete="off"
              spellCheck={false}
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'var(--text-main)',
                fontSize: 12,
                fontFamily: 'inherit',
                padding: 0,
              }}
            />
            <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {filtered.length}/{buckets.length}
            </span>
          </div>

          <ul
            id={listId}
            role="listbox"
            aria-label="R2 buckets"
            style={{ listStyle: 'none', margin: 0, padding: '4px 0', maxHeight: 12 * 32 + 8 }}
          >
            {pageItems.length === 0 ? (
              <li
                style={{
                  padding: '12px 12px',
                  fontSize: 12,
                  color: 'var(--text-muted)',
                }}
              >
                No buckets match “{query.trim()}”
              </li>
            ) : (
              pageItems.map((name, i) => {
                const active = i === highlight;
                const selected = name === value;
                return (
                  <li key={name} role="option" aria-selected={selected}>
                    <button
                      type="button"
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => selectBucket(name)}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        border: 'none',
                        padding: '7px 12px',
                        fontSize: 12,
                        fontFamily: 'inherit',
                        cursor: 'pointer',
                        background: active
                          ? 'color-mix(in srgb, var(--solar-cyan) 18%, var(--bg-elevated))'
                          : 'transparent',
                        color: selected ? 'var(--solar-cyan)' : 'var(--text-main)',
                        fontWeight: selected ? 600 : 400,
                      }}
                    >
                      {name}
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '6px 10px',
              borderTop: '1px solid var(--border-subtle)',
              background: 'var(--bg-elevated)',
            }}
          >
            <span style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.01em' }}>
              ↑↓ to navigate · ↵ to select
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 4 }}>
                {safePage} / {totalPages}
              </span>
              <PagerArrow
                label="Previous page"
                disabled={safePage <= 1}
                onClick={() => {
                  setPage((p) => Math.max(1, p - 1));
                  setHighlight(0);
                }}
              >
                <ChevronLeft size={14} />
              </PagerArrow>
              <PagerArrow
                label="Next page"
                disabled={safePage >= totalPages}
                onClick={() => {
                  setPage((p) => Math.min(totalPages, p + 1));
                  setHighlight(0);
                }}
              >
                <ChevronRight size={14} />
              </PagerArrow>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PagerArrow({
  children,
  disabled,
  onClick,
  label,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        borderRadius: 6,
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-panel)',
        color: disabled ? 'var(--text-muted)' : 'var(--text-main)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}
