import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, X } from 'lucide-react';

/**
 * Key→value tag map.
 * - CF Images: Cloudflare Resource Tagging (resource_type=image)
 * - R2 browse (`r2obj_`): IAM customMetadata / sidecar (CF has no per-object R2 tags)
 */
export type ResourceTagsMap = Record<string, string>;

export type ResourceTagGroup = {
  key: string;
  values: string[];
};

export type ImageTagPickerProps = {
  /** Current tags on this image (CF Resource Tagging or IAM R2 tags). */
  resourceTags: ResourceTagsMap;
  /** Account catalog: key → known values (from listAccountTagKeys + listValuesForKey). */
  groups?: ResourceTagGroup[];
  onChange: (next: ResourceTagsMap) => void;
};

function entriesOf(tags: ResourceTagsMap): Array<{ key: string; value: string }> {
  return Object.entries(tags || {})
    .filter(([k]) => k)
    .map(([key, value]) => ({ key, value: value == null ? '' : String(value) }));
}

export function ImageTagPicker({ resourceTags, groups = [], onChange }: ImageTagPickerProps) {
  const [open, setOpen] = useState(false);
  const [draftKey, setDraftKey] = useState('');
  const [draftValue, setDraftValue] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (open) {
      setDraftKey('');
      setDraftValue('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const q = draftKey.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => {
        const keyHit = g.key.toLowerCase().includes(q);
        const values = g.values.filter((v) => String(v).toLowerCase().includes(q));
        if (keyHit) return { key: g.key, values: g.values };
        if (values.length) return { key: g.key, values };
        return null;
      })
      .filter(Boolean) as ResourceTagGroup[];
  }, [groups, q]);

  const keyNorm = draftKey.trim();
  const valueNorm = draftValue.trim();
  const canCreate =
    !!keyNorm &&
    /^[\p{L}\p{N}_.-]+$/u.test(keyNorm) &&
    !/\s/.test(keyNorm) &&
    keyNorm.length <= 256 &&
    valueNorm.length <= 1024;

  const applyPair = (key: string, value: string) => {
    const k = key.trim();
    const v = value.trim();
    if (!k) return;
    onChange({ ...resourceTags, [k]: v });
    setDraftKey('');
    setDraftValue('');
    setOpen(false);
  };

  const removeKey = (key: string) => {
    const next = { ...resourceTags };
    delete next[key];
    onChange(next);
  };

  const chips = entriesOf(resourceTags);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {chips.map(({ key, value }) => (
          <span
            key={key}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 999,
              background: 'color-mix(in srgb, var(--solar-cyan) 16%, transparent)',
              border: '1px solid color-mix(in srgb, var(--solar-cyan) 35%, transparent)',
              color: 'var(--solar-cyan)',
            }}
            title={`${key}=${value}`}
          >
            <strong style={{ fontWeight: 600 }}>{key}</strong>
            <span style={{ opacity: 0.85 }}>=</span>
            <span>{value || '—'}</span>
            <button
              type="button"
              onClick={() => removeKey(key)}
              aria-label={`Remove ${key}`}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: 'inherit',
                lineHeight: 1,
                display: 'flex',
              }}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            padding: '3px 10px',
            borderRadius: 999,
            border: '1px dashed var(--border-subtle)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <Plus size={11} />
          Add tag
        </button>
      </div>

      {open && (
        <div
          style={{
            position: 'absolute',
            zIndex: 40,
            top: '100%',
            left: 0,
            minWidth: 280,
            maxWidth: 340,
            marginTop: 4,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'relative', padding: 8, borderBottom: '1px solid var(--border-subtle)' }}>
            <Search
              size={13}
              style={{
                position: 'absolute',
                left: 16,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                pointerEvents: 'none',
              }}
            />
            <input
              ref={inputRef}
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
              }}
              placeholder="Search keys…"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '7px 10px 7px 28px',
                borderRadius: 7,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-panel)',
                color: 'var(--text-main)',
                fontSize: 12,
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 6 }}>
            <input
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder="key"
              style={{
                flex: 1,
                boxSizing: 'border-box',
                padding: '6px 8px',
                borderRadius: 6,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-panel)',
                color: 'var(--text-main)',
                fontSize: 12,
                fontFamily: 'inherit',
              }}
            />
            <input
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canCreate) {
                  e.preventDefault();
                  applyPair(keyNorm, valueNorm);
                }
              }}
              placeholder="value"
              style={{
                flex: 1,
                boxSizing: 'border-box',
                padding: '6px 8px',
                borderRadius: 6,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-panel)',
                color: 'var(--text-main)',
                fontSize: 12,
                fontFamily: 'inherit',
              }}
            />
          </div>

          <ul style={{ listStyle: 'none', margin: 0, padding: 4, maxHeight: 260, overflowY: 'auto' }}>
            {filteredGroups.map((g) => (
              <li key={g.key} style={{ marginBottom: 4 }}>
                <div
                  style={{
                    padding: '6px 10px 2px',
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--text-main)',
                    letterSpacing: 0.2,
                  }}
                >
                  {g.key}
                </div>
                {(g.values.length ? g.values : ['']).map((v) => (
                  <button
                    key={`${g.key}=${v}`}
                    type="button"
                    onClick={() => applyPair(g.key, v || draftValue || '')}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 10px 6px 18px',
                      border: 'none',
                      borderRadius: 6,
                      background: 'transparent',
                      color: 'var(--text-muted)',
                      fontSize: 12,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--bg-panel)';
                      e.currentTarget.style.color = 'var(--text-main)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = 'var(--text-muted)';
                    }}
                  >
                    {v || 'Set value…'}
                  </button>
                ))}
              </li>
            ))}
            {canCreate && (
              <li>
                <button
                  type="button"
                  onClick={() => applyPair(keyNorm, valueNorm)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    border: 'none',
                    borderRadius: 6,
                    background: 'transparent',
                    color: 'var(--solar-cyan)',
                    fontSize: 12,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontWeight: 500,
                  }}
                >
                  Create {keyNorm}={valueNorm || '…'}
                </button>
              </li>
            )}
            {!filteredGroups.length && !canCreate && (
              <li style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                No matching account tags — enter a key and value above
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export default ImageTagPicker;
