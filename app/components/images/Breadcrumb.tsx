import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ImageIcon } from 'lucide-react';

export type BreadcrumbItem = {
  label: string;
  to?: string;
  /** Show the small image icon in front of this crumb (first crumb only, matches CF). */
  icon?: boolean;
};

/**
 * Multi-level breadcrumb trail matching CF's "Hosted images > Variants > Create
 * variant" pattern. Replaces the hand-rolled single-link back-buttons that were
 * scattered across ImagesDetailPage/ImagesEditPage/ImagesDeliveryVariantCreatePage.
 */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: 'var(--text-muted)',
        marginBottom: 14,
        flexWrap: 'wrap',
      }}
      aria-label="Breadcrumb"
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const content = (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: isLast ? 'var(--text-main)' : 'var(--text-muted)',
              fontWeight: isLast ? 500 : 400,
            }}
          >
            {item.icon ? <ImageIcon size={12} /> : null}
            {item.label}
          </span>
        );
        return (
          <React.Fragment key={`${item.label}-${i}`}>
            {i > 0 ? <ChevronRight size={12} style={{ flexShrink: 0, opacity: 0.6 }} /> : null}
            {item.to && !isLast ? (
              <Link to={item.to} style={{ textDecoration: 'none' }}>
                {content}
              </Link>
            ) : (
              content
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}

export default Breadcrumb;
