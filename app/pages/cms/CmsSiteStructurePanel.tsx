import React from 'react';
import type { CmsWorkspaceContext } from '../../hooks/useCmsWorkspaceContext';

type Props = {
  siteSlug: string;
  context?: CmsWorkspaceContext | null;
  pageCount?: number;
  themeCount?: number;
  importCount?: number;
};

export function CmsSiteStructurePanel({ siteSlug, context, pageCount = 0, themeCount = 0, importCount = 0 }: Props) {
  const rows = [
    { label: 'Site slug', value: siteSlug },
    { label: 'Workspace', value: context?.workspace_id || '—' },
    { label: 'Public domain', value: context?.public_domain || '—' },
    { label: 'Hosting', value: context?.cms_hosting || 'platform' },
    { label: 'API profile', value: context?.api_profile || '—' },
    { label: 'Studio URL', value: context?.studio_url ? context.studio_url.replace(/^https?:\/\//, '') : '—' },
    { label: 'Worker base', value: context?.worker_base_url ? context.worker_base_url.replace(/^https?:\/\//, '') : '—' },
    { label: 'Bridge', value: context?.bridge_supported ? 'enabled' : '—' },
    { label: 'Pages', value: String(pageCount) },
    { label: 'Themes', value: String(themeCount) },
    { label: 'Imports', value: String(importCount) },
  ];

  return (
    <section className="iam-cms-card iam-cms-structure-panel">
      <div className="iam-cms-panel-head">Site structure &amp; bindings</div>
      <p className="iam-cms-structure-panel__lede iam-cms-muted">
        Workspace-level bindings shared by this CMS site. Rules, instructions, and memory stay scoped per dashboard project.
      </p>
      <dl className="iam-cms-structure-panel__grid">
        {rows.map((row) => (
          <div key={row.label} className="iam-cms-structure-panel__row">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default CmsSiteStructurePanel;
