import type { ReactNode } from 'react';

export type SiteCtaProps = {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  action: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
};

export function SiteCta({ eyebrow, title, description, action, secondaryAction, className = '' }: SiteCtaProps) {
  return (
    <section className={`px-5 py-16 sm:px-8 sm:py-24 ${className}`.trim()}>
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 rounded-3xl bg-neutral-950 p-8 text-white sm:p-12 lg:flex-row lg:items-end">
        <div className="max-w-3xl">
          {eyebrow ? <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-white/55">{eyebrow}</div> : null}
          <h2 className="m-0 text-3xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl">{title}</h2>
          {description ? <div className="mt-4 max-w-2xl text-base leading-7 text-white/65">{description}</div> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">{action}{secondaryAction}</div>
      </div>
    </section>
  );
}
