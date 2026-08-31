import type { ReactNode } from 'react';

export type FeatureGridItem = {
  id: string;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
};

export type FeatureGridProps = {
  items: FeatureGridItem[];
  columns?: 2 | 3 | 4;
  className?: string;
};

export function FeatureGrid({ items, columns = 3, className = '' }: FeatureGridProps) {
  const cols = columns === 2 ? 'md:grid-cols-2' : columns === 4 ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-3';
  return (
    <section className={`bg-white ${className}`.trim()}>
      <div className={`mx-auto grid max-w-7xl gap-px overflow-hidden rounded-2xl border border-black/8 bg-black/8 ${cols}`}>
        {items.map((item) => (
          <article key={item.id} className="min-h-52 bg-white p-6 sm:p-8">
            {item.icon ? <div className="mb-8 text-neutral-500">{item.icon}</div> : null}
            {item.eyebrow ? <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">{item.eyebrow}</div> : null}
            <h2 className="m-0 text-xl font-semibold tracking-[-0.03em] text-neutral-950">{item.title}</h2>
            {item.description ? <div className="mt-3 text-sm leading-6 text-neutral-600">{item.description}</div> : null}
          </article>
        ))}
      </div>
    </section>
  );
}
