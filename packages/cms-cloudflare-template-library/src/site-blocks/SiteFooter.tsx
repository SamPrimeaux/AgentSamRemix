import type { ReactNode } from 'react';

export type SiteFooterColumn = { title: string; links: { label: string; href: string }[] };

export type SiteFooterProps = {
  brand: ReactNode;
  description?: ReactNode;
  columns?: SiteFooterColumn[];
  legal?: ReactNode;
  className?: string;
};

export function SiteFooter({ brand, description, columns = [], legal, className = '' }: SiteFooterProps) {
  return (
    <footer className={`border-t border-black/8 bg-neutral-50 ${className}`.trim()}>
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 sm:px-8 lg:grid-cols-[1.2fr_2fr]">
        <div className="max-w-sm">
          {brand}
          {description ? <div className="mt-4 text-sm leading-6 text-neutral-600">{description}</div> : null}
        </div>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {columns.map((column) => (
            <div key={column.title}>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">{column.title}</div>
              <div className="mt-4 flex flex-col gap-2.5">
                {column.links.map((link) => <a key={`${column.title}:${link.href}`} href={link.href} className="text-sm text-neutral-600 hover:text-neutral-950">{link.label}</a>)}
              </div>
            </div>
          ))}
        </div>
      </div>
      {legal ? <div className="mx-auto max-w-7xl border-t border-black/8 px-5 py-5 text-xs text-neutral-500 sm:px-8">{legal}</div> : null}
    </footer>
  );
}
