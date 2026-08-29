import type { ReactNode } from 'react';

export function KpiGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">{children}</div>
  );
}
