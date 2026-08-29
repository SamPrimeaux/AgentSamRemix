import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

import './database-resource-picker.css';

export type DatabaseResourceOption = {
  value: string;
  label: string;
  subtitle?: string;
  meta?: string;
};

type Props = {
  value: string;
  options: DatabaseResourceOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  emptyLabel?: string;
};

export function DatabaseResourcePicker({
  value,
  options,
  onChange,
  placeholder = 'Select database',
  ariaLabel,
  disabled = false,
  emptyLabel = 'No databases',
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((opt) => {
      const hay = `${opt.label} ${opt.subtitle || ''} ${opt.meta || ''} ${opt.value}`.toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  const selected = options.find((opt) => opt.value === value) || null;
  const showSearch = options.length > 6;

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      if (showSearch) inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, showSearch]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
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

  const selectValue = useCallback(
    (next: string) => {
      onChange(next);
      setOpen(false);
      setQuery('');
      setHighlight(0);
    },
    [onChange],
  );

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (!filtered.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = filtered[highlight];
      if (pick) selectValue(pick.value);
    }
  };

  return (
    <div ref={rootRef} className="database-resource-picker">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        className="database-resource-picker-trigger"
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className="database-resource-picker-trigger-text">
          <span className="database-resource-picker-label">{selected?.label || placeholder}</span>
          {selected?.meta ? <span className="database-resource-picker-meta">{selected.meta}</span> : null}
        </span>
        <ChevronDown size={14} aria-hidden="true" className="database-resource-picker-caret" />
      </button>
      {open ? (
        <div className="database-resource-picker-menu" role="presentation">
          {showSearch ? (
            <div className="database-resource-picker-search">
              <Search size={12} aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onListKeyDown}
                placeholder="Search databases…"
                aria-label="Search databases"
              />
            </div>
          ) : null}
          <div
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={showSearch ? -1 : 0}
            onKeyDown={onListKeyDown}
            className="database-resource-picker-list"
          >
            {filtered.length ? (
              filtered.map((opt, index) => {
                const isSelected = opt.value === value;
                const isActive = index === highlight;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`database-resource-picker-option${isSelected ? ' is-selected' : ''}${isActive ? ' is-active' : ''}`}
                    onMouseEnter={() => setHighlight(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => selectValue(opt.value)}
                  >
                    <span className="database-resource-picker-option-copy">
                      <span className="database-resource-picker-label">{opt.label}</span>
                      {opt.subtitle ? (
                        <span className="database-resource-picker-subtitle">{opt.subtitle}</span>
                      ) : null}
                    </span>
                    {isSelected ? <Check size={14} className="database-resource-picker-check" /> : null}
                  </button>
                );
              })
            ) : (
              <div className="database-resource-picker-empty">{emptyLabel}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
