import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';

export type DropdownOption = {
  value: string;
  label: string;
  hint?: string;
};

export type DropdownProps = {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
};

/**
 * Custom listbox matching the real Cloudflare dashboard's Create Variant / Edit
 * image dropdowns exactly: bordered field showing the current value, click opens
 * an absolutely-positioned panel below listing every option with a checkmark on
 * the current selection, hover highlight, click-outside-to-close. Native <select>
 * elements render as the OS/browser's own popup and can't be styled to match this,
 * which is why the earlier version of these pages looked visibly "off" vs CF.
 */
export function Dropdown({ value, options, onChange, placeholder }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '8px 10px',
          borderRadius: 8,
          border: open ? '1px solid var(--solar-cyan)' : '1px solid var(--border-subtle)',
          background: 'var(--bg-elevated)',
          color: selected ? 'var(--text-main)' : 'var(--text-muted)',
          fontSize: 13,
          fontFamily: 'inherit',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span>{selected ? selected.label : placeholder || 'Select…'}</span>
        <ChevronsUpDown size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 20,
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-elevated)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            overflow: 'hidden',
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                onMouseDown={(e) => e.preventDefault()}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 10px',
                  border: 'none',
                  borderBottom: '1px solid color-mix(in srgb, var(--border-subtle) 60%, transparent)',
                  background: isSelected
                    ? 'color-mix(in srgb, var(--solar-cyan) 10%, transparent)'
                    : 'transparent',
                  color: 'var(--text-main)',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'var(--bg-panel)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span>{opt.label}</span>
                {isSelected ? <Check size={14} style={{ color: 'var(--solar-cyan)', flexShrink: 0 }} /> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Dropdown;
