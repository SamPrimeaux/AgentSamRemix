import React from 'react';
import { NAMED_VARIANTS, type NamedVariantId } from './imagesRegistry';

export type ImageVariantGridProps = {
  variants: Record<string, string>;
  selected?: string | null;
  onSelect: (variantId: string) => void;
  /**
   * Real, account-fetched dimension labels (from /api/images/variants/catalog),
   * keyed by variant id. Overrides the static NAMED_VARIANTS guesses when
   * provided — named variants are account-specific, the static list is only a
   * fallback for when the real catalog can't be loaded.
   */
  hints?: Record<string, string>;
};

const DEFAULT_HINTS: Record<string, string> = Object.fromEntries(
  NAMED_VARIANTS.map((v) => [v.id, v.hint]),
);

/**
 * Variant selector — matches the real Cloudflare dashboard's Preview section
 * exactly: bordered tiles carrying only the variant name + dimensions, no
 * per-tile thumbnail. CF does not eager-load a distinct <img> for every
 * variant tile — only the single selected variant is fetched/rendered, in
 * the Preview panel below this grid (see ImagesDetailPage.tsx). Loading 7
 * full images per page view here was both visually wrong (didn't match CF)
 * and wasteful (7x the transform/bandwidth cost of what CF's own UI does).
 */
export function ImageVariantGrid({ variants, selected, onSelect, hints }: ImageVariantGridProps) {
  const ids = Object.keys(variants).length
    ? Object.keys(variants)
    : (NAMED_VARIANTS.map((v) => v.id) as string[]);
  const HINTS = hints || DEFAULT_HINTS;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
        gap: 8,
      }}
    >
      {ids.map((id) => {
        const active = selected === id;
        const hint = HINTS[id] || '';
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            aria-pressed={active}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 2,
              padding: '10px 12px',
              borderRadius: 8,
              border: active
                ? '1px solid var(--solar-cyan)'
                : '1px solid var(--border-subtle)',
              background: active
                ? 'color-mix(in srgb, var(--solar-cyan) 8%, var(--bg-elevated))'
                : 'var(--bg-elevated)',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
              transition: 'border-color 120ms ease, background 120ms ease',
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: active ? 'var(--solar-cyan)' : 'var(--text-main)',
              }}
            >
              {id}
            </div>
            {hint ? (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hint}</div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export type { NamedVariantId };
export default ImageVariantGrid;
