import type { ReactNode } from 'react';
import { Banner } from '@cloudflare/kumo/components/banner';
import { Info, X } from '@phosphor-icons/react';

export type AppBannerPlacement = 'inline' | 'top-fixed' | 'bottom-fixed';

export type AppBannerProps = {
  title?: string;
  description: ReactNode;
  variant?: 'default' | 'alert' | 'error' | 'secondary';
  placement?: AppBannerPlacement;
  primaryAction?: { label: string; onClick: () => void; disabled?: boolean };
  onDismiss?: () => void;
  className?: string;
};

const placementClass: Record<AppBannerPlacement, string> = {
  inline: '',
  'top-fixed': 'fixed left-3 right-3 top-[max(0.75rem,env(safe-area-inset-top,0px))] z-[19999] mx-auto max-w-4xl',
  'bottom-fixed': 'fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] left-3 right-3 z-[19990] mx-auto max-w-2xl',
};

export function AppBanner({
  title,
  description,
  variant = 'secondary',
  placement = 'inline',
  primaryAction,
  onDismiss,
  className = '',
}: AppBannerProps) {
  return (
    <div className={`${placementClass[placement]} ${className}`.trim()} role="status" aria-live="polite">
      <Banner
        size="sm"
        variant={variant}
        icon={<Info weight="fill" />}
        title={title}
        description={description}
        action={
          primaryAction || onDismiss ? (
            <>
              {primaryAction ? (
                <Banner.Action onClick={primaryAction.onClick} disabled={primaryAction.disabled}>
                  {primaryAction.label}
                </Banner.Action>
              ) : null}
              {onDismiss ? (
                <Banner.Action variant="ghost" icon={<X />} aria-label="Dismiss" onClick={onDismiss} />
              ) : null}
            </>
          ) : undefined
        }
      />
    </div>
  );
}
