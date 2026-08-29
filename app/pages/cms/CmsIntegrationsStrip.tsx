import React from 'react';
import { Link } from 'react-router-dom';
import { AppIcon } from '../../components/ui/AppIcon';
import type { CmsConnectedIntegration } from './useCmsConnectedIntegrations';

type Props = {
  items: CmsConnectedIntegration[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

export function CmsIntegrationsStrip({ items, loading, error, onRetry }: Props) {
  return (
    <section className="iam-cms-integrations-strip" aria-label="Connected integrations">
      <div className="iam-cms-integrations-strip__head">
        <span className="iam-cms-integrations-strip__title">Connected apps</span>
        <Link to="/dashboard/settings?section=integrations" className="iam-cms-integrations-strip__manage">
          Manage
        </Link>
      </div>
      {loading ? (
        <div className="iam-cms-integrations-strip__row" aria-hidden>
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="iam-cms-integrations-strip__skel" />
          ))}
        </div>
      ) : error ? (
        <div className="iam-cms-integrations-strip__empty">
          {error}
          {onRetry ? (
            <button type="button" className="iam-cms-shell__nav-link" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      ) : items.length === 0 ? (
        <div className="iam-cms-integrations-strip__empty">
          No integrations connected yet.
          <Link to="/dashboard/settings?section=integrations">Connect services</Link>
        </div>
      ) : (
        <div className="iam-cms-integrations-strip__row">
          {items.map((item) => (
            <div key={item.providerKey} className="iam-cms-integrations-strip__app" title={item.displayName}>
              <AppIcon
                title={item.displayName}
                providerKey={item.providerKey}
                iconSlug={item.iconSlug || item.providerKey}
                size="sm"
                presentation="brand"
              />
              <span className="iam-cms-integrations-strip__app-name">{item.displayName}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
