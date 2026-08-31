import type { ReactNode } from 'react';

export type SiteNavItem = { label: string; href: string };

export type SiteHeaderProps = {
  brand: ReactNode;
  nav?: SiteNavItem[];
  action?: ReactNode;
  className?: string;
};

export function SiteHeader({ brand, nav = [], action, className = '' }: SiteHeaderProps) {
  return (
    <header className={`w-full border-b border-black/8 bg-white/92 backdrop-blur ${className}`.trim()}>
      <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-6 px-5 sm:px-8">
        <div className="min-w-0 shrink-0">{brand}</div>
        {nav.length ? (
          <nav className="hidden min-w-0 flex-1 items-center justify-center gap-6 md:flex" aria-label="Primary">
            {nav.map((item) => (
              <a key={`${item.href}:${item.label}`} href={item.href} className="text-sm text-neutral-600 transition-colors hover:text-neutral-950">
                {item.label}
              </a>
            ))}
          </nav>
        ) : <div className="flex-1" />}
        {action ? <div className="ml-auto shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}
