import React from 'react';
import { useSettingsSectionStatus } from '../hooks/useSettingsSectionStatus';
import {
  ActionRow,
  DataTable,
  EmptyState,
  LoadingRow,
  RelTime,
  SectionHeader,
  SummaryGrid,
  WarningStrip,
} from '../components/SectionPrimitives';

export type DocsSectionProps = {
  onOpenInMonaco?: (content: string, virtualPath: string) => void;
  onFileSelect?: (file: { name: string; content: string }) => void;
};

type CmsPageRow = {
  id?: string;
  slug?: string;
  title?: string;
  status?: string;
  updated_at?: string | number | null;
};

type RuleDocRow = {
  id?: string;
  title?: string;
  scope?: string;
  is_active?: number;
  updated_at?: string | number | null;
};

type ProjectContextRow = {
  id?: string;
  scope_type?: string;
  scope_id?: string;
  kind?: string;
  updated_at?: string | number | null;
};

type DocsSummary = {
  cms_pages_count?: number;
  rule_documents_count?: number;
  project_context_entries?: number;
  cms_assets_total?: number;
  r2_object_inventory_total?: number;
  knowledge_graph_status?: string;
  knowledge_graph_note?: string;
};

type DocsExtra = {
  rule_documents?: RuleDocRow[];
  project_context?: ProjectContextRow[];
};

export function DocsSection({ onOpenInMonaco, onFileSelect }: DocsSectionProps) {
  const { data: section, loading, error, reload } = useSettingsSectionStatus<CmsPageRow>({
    endpoint: '/api/settings/docs',
  });

  const summary = (section?.summary || {}) as DocsSummary;
  const extra = (section?.extra || {}) as DocsExtra;

  const openSnippet = (title: string, body: string) => {
    const path = `${title.replace(/\s+/g, '-').toLowerCase()}.md`;
    if (onOpenInMonaco) onOpenInMonaco(body, path);
    else if (onFileSelect) onFileSelect({ name: path, content: body });
  };

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <SectionHeader
        title="Documentation"
        description="CMS pages, rule documents, project context, and a count of CMS / R2 inventory items. Knowledge graph (Supabase) is referenced by status only."
        right={
          <button
            type="button"
            onClick={() => reload()}
            disabled={loading}
            className="text-[11px] px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-muted hover:text-main disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {error ? (
        <div className="text-[11px] text-[var(--color-danger)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 rounded-xl px-3 py-2">
          {error}
        </div>
      ) : null}
      {loading && !section ? <LoadingRow /> : null}

      {section ? (
        <>
          <SummaryGrid
            items={[
              { label: 'CMS pages', value: String(summary.cms_pages_count ?? 0) },
              { label: 'Rule documents', value: String(summary.rule_documents_count ?? 0) },
              {
                label: 'Project context',
                value: String(summary.project_context_entries ?? 0),
              },
              { label: 'CMS assets', value: String(summary.cms_assets_total ?? 0) },
              {
                label: 'R2 inventory rows',
                value: String(summary.r2_object_inventory_total ?? 0),
              },
              {
                label: 'Knowledge graph',
                value: summary.knowledge_graph_status || '—',
                hint: 'Supabase-backed',
              },
            ]}
          />
          {summary.knowledge_graph_note ? (
            <p className="text-[11px] text-muted">{summary.knowledge_graph_note}</p>
          ) : null}
          <WarningStrip warnings={section.warnings} />
          <ActionRow actions={section.actions} />

          <section className="flex flex-col gap-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted">
              CMS pages
            </div>
            {(section.rows || []).length === 0 ? (
              <EmptyState message="No cms_pages rows visible to this workspace." />
            ) : (
              <DataTable<CmsPageRow>
                emptyMessage="No pages."
                rows={(section.rows || []) as CmsPageRow[]}
                columns={[
                  { key: 'title', label: 'Title', widthClass: 'minmax(0, 1.2fr)' },
                  { key: 'slug', label: 'Slug', widthClass: 'minmax(0, 0.8fr)' },
                  { key: 'status', label: 'Status', widthClass: 'minmax(0, 0.5fr)' },
                  {
                    key: 'updated_at',
                    label: 'Updated',
                    widthClass: 'minmax(0, 0.6fr)',
                    render: (row) => <RelTime value={row.updated_at ?? null} />,
                  },
                ]}
              />
            )}
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-muted">
                Rule documents
              </div>
              {(extra.rule_documents || []).length === 0 ? (
                <EmptyState message="No agentsam_rules_document rows." />
              ) : (
                <DataTable<RuleDocRow>
                  emptyMessage="No rules."
                  rows={extra.rule_documents || []}
                  columns={[
                    { key: 'title', label: 'Title' },
                    { key: 'scope', label: 'Scope' },
                    {
                      key: 'is_active',
                      label: 'Active',
                      render: (row) => (Number(row.is_active) === 1 ? 'yes' : 'no'),
                    },
                  ]}
                />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-muted">
                Project context entries
              </div>
              {(extra.project_context || []).length === 0 ? (
                <EmptyState message="No agentsam_project_context rows." />
              ) : (
                <DataTable<ProjectContextRow>
                  emptyMessage="No entries."
                  rows={extra.project_context || []}
                  columns={[
                    { key: 'scope_type', label: 'Scope type' },
                    { key: 'scope_id', label: 'Scope id' },
                    { key: 'kind', label: 'Kind' },
                  ]}
                />
              )}
            </div>
          </section>
        </>
      ) : null}

      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-5">
        <div className="text-[12px] font-semibold text-main">
          Deploy scripts (reference)
        </div>
        <p className="text-[11px] text-muted mt-2">
          Sandbox first, then promote. Open as a read-only snippet in the editor.
        </p>
        <button
          type="button"
          onClick={() =>
            openSnippet(
              'deploy-scripts',
              `# Sandbox\n./scripts/deploy-sandbox.sh\n\n# Production promote\n./scripts/promote-to-prod.sh`,
            )
          }
          className="mt-3 px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-[11px] text-muted hover:text-[var(--solar-cyan)] hover:border-[var(--solar-cyan)]/40"
        >
          Open in Monaco
        </button>
      </div>
    </div>
  );
}
