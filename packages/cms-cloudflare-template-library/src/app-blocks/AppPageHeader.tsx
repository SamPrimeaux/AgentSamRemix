import type { ReactNode } from 'react';
import { Tabs, type TabsItem } from '@cloudflare/kumo/components/tabs';

export type AppPageHeaderProps = {
  breadcrumbs?: ReactNode;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  tabs?: TabsItem[];
  selectedTab?: string;
  onTabChange?: (value: string) => void;
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
};

/**
 * IAM-owned page header composition. It intentionally keeps routing and product behavior outside
 * the block so dashboards and generated customer admin surfaces can share the same presentation.
 */
export function AppPageHeader({
  breadcrumbs,
  eyebrow,
  title,
  description,
  tabs,
  selectedTab,
  onTabChange,
  actions,
  className = '',
  compact = false,
}: AppPageHeaderProps) {
  return (
    <header className={`flex min-w-0 flex-col border-b border-kumo-line bg-kumo-base ${className}`.trim()}>
      {breadcrumbs ? <div className="border-b border-kumo-line px-4 py-2">{breadcrumbs}</div> : null}
      <div className={`flex min-w-0 items-start justify-between gap-4 px-4 ${compact ? 'py-3' : 'py-5'}`}>
        <div className="min-w-0">
          {eyebrow ? (
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-kumo-brand">{eyebrow}</div>
          ) : null}
          <h1 className={`${compact ? 'text-xl' : 'text-3xl'} m-0 font-semibold tracking-[-0.04em] text-kumo-strong`}>
            {title}
          </h1>
          {description ? <div className="mt-1.5 max-w-3xl text-sm leading-5 text-kumo-subtle">{description}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {tabs?.length ? (
        <div className="flex items-center px-4 pb-2">
          <Tabs
            tabs={tabs}
            selectedValue={selectedTab}
            onValueChange={(value) => onTabChange?.(String(value))}
          />
        </div>
      ) : null}
    </header>
  );
}
