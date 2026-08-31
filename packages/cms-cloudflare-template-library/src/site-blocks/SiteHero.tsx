import type { ReactNode } from 'react';

export type SiteHeroProps = {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  media?: ReactNode;
  align?: 'left' | 'center';
  className?: string;
};

export function SiteHero({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
  media,
  align = 'left',
  className = '',
}: SiteHeroProps) {
  const centered = align === 'center';
  return (
    <section className={`overflow-hidden bg-white ${className}`.trim()}>
      <div className={`mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 sm:py-24 ${media ? 'lg:grid-cols-[1.05fr_.95fr] lg:items-center' : ''}`}>
        <div className={centered ? 'mx-auto max-w-4xl text-center' : 'max-w-3xl'}>
          {eyebrow ? <div className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500">{eyebrow}</div> : null}
          <h1 className="m-0 text-balance text-4xl font-semibold leading-[0.98] tracking-[-0.055em] text-neutral-950 sm:text-6xl lg:text-7xl">
            {title}
          </h1>
          {description ? <div className="mt-6 text-pretty text-base leading-7 text-neutral-600 sm:text-lg">{description}</div> : null}
          {primaryAction || secondaryAction ? (
            <div className={`mt-8 flex flex-wrap gap-3 ${centered ? 'justify-center' : ''}`}>
              {primaryAction}
              {secondaryAction}
            </div>
          ) : null}
        </div>
        {media ? <div className="min-w-0">{media}</div> : null}
      </div>
    </section>
  );
}
