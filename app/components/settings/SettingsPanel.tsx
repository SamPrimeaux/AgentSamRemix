import React, { lazy, Suspense, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { SLUG_TO_LABEL, LABEL_TO_SLUG, DEFAULT_SLUG, DEFAULT_LABEL } from './settingsConstants';
import { Package, PanelLeft, PanelLeftClose } from 'lucide-react';
import { useSettingsData } from './hooks/useSettingsData';
import { useSettingsSections } from './hooks/useSettingsSections';
import { SectionNav } from './components/SectionNav';
import { initialsFromDisplayName, formatPlanLabel } from './settingsUi';

const SECTION_LOADERS: Record<string, React.LazyExoticComponent<React.ComponentType<any>>> = {
  General: lazy(() => import('./sections/GeneralSection').then((m) => ({ default: m.GeneralSection }))),
  Agents: lazy(() => import('./sections/AgentsSection').then((m) => ({ default: m.AgentsSection }))),
  'AI Models': lazy(() => import('./sections/AIModelsSection').then((m) => ({ default: m.AIModelsSection }))),
  'Tools & MCP': lazy(() => import('./sections/ToolsMcpSection').then((m) => ({ default: m.ToolsMcpSection }))),
  'Rules & Skills': lazy(() =>
    import('./sections/RulesSkillsSection').then((m) => ({ default: m.RulesSkillsSection })),
  ),
  Workspace: lazy(() => import('./sections/WorkspaceSection').then((m) => ({ default: m.WorkspaceSection }))),
  'Brand & Design': lazy(() =>
    import('./sections/BrandDesignSection').then((m) => ({ default: m.BrandDesignSection })),
  ),
  Hooks: lazy(() => import('./sections/HooksSection').then((m) => ({ default: m.HooksSection }))),
  GitHub: lazy(() => import('./sections/GitHubSection').then((m) => ({ default: m.GitHubSection }))),
  'Index Rules': lazy(() =>
    import('./sections/IndexRulesSection').then((m) => ({ default: m.IndexRulesSection })),
  ),
  Integrations: lazy(() =>
    import('./sections/IntegrationsSection').then((m) => ({ default: m.IntegrationsSection })),
  ),
  'CI/CD': lazy(() => import('./sections/CiCdSection').then((m) => ({ default: m.CiCdSection }))),
  Network: lazy(() => import('./sections/NetworkSection').then((m) => ({ default: m.NetworkSection }))),
  Themes: lazy(() => import('./sections/ThemesSection').then((m) => ({ default: m.ThemesSection }))),
  Storage: lazy(() => import('./sections/StorageSection').then((m) => ({ default: m.StorageSection }))),
  'Keys & Secrets': lazy(() => import('./sections/ApiKeysSection').then((m) => ({ default: m.KeysSection }))),
  'Plan & Usage': lazy(() => import('./sections/PlanUsageSection').then((m) => ({ default: m.PlanUsageSection }))),
  Notifications: lazy(() =>
    import('./sections/NotificationsSection').then((m) => ({ default: m.NotificationsSection })),
  ),
  Docs: lazy(() => import('./sections/DocsSection').then((m) => ({ default: m.DocsSection }))),
};

function SectionSkeleton() {
  return (
    <div className="px-6 py-8 flex flex-col gap-3 opacity-40">
      {[200, 160, 240, 120].map((w, i) => (
        <div
          key={i}
          className="h-3.5 rounded animate-pulse bg-[var(--dashboard-border)]"
          style={{ width: w, animationDelay: `${i * 0.1}s` }}
        />
      ))}
    </div>
  );
}

export interface SettingsPanelProps {
  onClose: () => void;
  onFileSelect?: (file: { name: string; content: string }) => void;
  onOpenInMonaco?: (content: string, virtualPath: string) => void;
  workspaceId?: string | null;
}

export default function SettingsPanel({
  onClose,
  onFileSelect,
  onOpenInMonaco,
  workspaceId,
}: SettingsPanelProps) {
  const { sectionSlug } = useParams<{ sectionSlug: string }>();
  const navigateTo = useNavigate();
  const [searchParams] = useSearchParams();

  const resolvedLabel: string =
    sectionSlug && SLUG_TO_LABEL[sectionSlug] ? SLUG_TO_LABEL[sectionSlug] : DEFAULT_LABEL;

  const legacySection = searchParams.get('section');
  useEffect(() => {
    if (!legacySection) return;
    navigateTo(`/dashboard/settings/${LABEL_TO_SLUG[legacySection] ?? DEFAULT_SLUG}`, { replace: true });
  }, [legacySection, navigateTo]);

  useEffect(() => {
    if (sectionSlug === 'api-keys') {
      navigateTo('/dashboard/settings/keys', { replace: true });
    }
  }, [sectionSlug, navigateTo]);

  useEffect(() => {
    if (sectionSlug === 'security') {
      navigateTo('/dashboard/settings/keys#security-findings', { replace: true });
    }
  }, [sectionSlug, navigateTo]);

  const handleSectionSelect = (label: string) => {
    navigateTo(`/dashboard/settings/${LABEL_TO_SLUG[label] ?? DEFAULT_SLUG}`);
  };

  const nav = useSettingsSections(resolvedLabel);
  const data = useSettingsData({
    workspaceId,
    activeSection: nav.activeSection,
    rulesSkillsTab: nav.rulesSkillsTab,
    modelsTab: nav.modelsTab,
  });

  useEffect(() => {
    if (sectionSlug !== 'rules') return;
    const tab = searchParams.get('tab');
    if (tab === 'subagents' || tab === 'skills' || tab === 'commands' || tab === 'rules') {
      nav.setRulesSkillsTab(tab);
      return;
    }
    // Default Rules & Skills landing stays on Rules when no tab query.
  }, [sectionSlug, searchParams, nav.setRulesSkillsTab]);

  useEffect(() => {
    if (sectionSlug !== 'rules') return;
    if (searchParams.get('tab') !== 'subagents') return;
    const id = String(searchParams.get('id') || '').trim();
    const slug = String(searchParams.get('slug') || '').trim();
    if (!id && !slug) return;
    if (data.subagentsLoading) return;
    const list = data.subagents || [];
    const sa =
      (id && list.find((x) => String(x.id) === id)) ||
      (slug && list.find((x) => String(x.slug) === slug)) ||
      null;
    if (sa) data.openEditSubagent(sa);
  }, [
    sectionSlug,
    searchParams,
    data.subagentsLoading,
    data.subagents,
    data.openEditSubagent,
  ]);

  const sectionBody = () => {
    switch (resolvedLabel) {
      case 'General': {
        const C = SECTION_LOADERS.General;
        return <C workspaceId={workspaceId} data={data} />;
      }
      case 'Agents': {
        const C = SECTION_LOADERS.Agents;
        return <C data={data} workspaceId={workspaceId} />;
      }
      case 'AI Models': {
        const C = SECTION_LOADERS['AI Models'];
        return <C data={data} modelsTab={nav.modelsTab} setModelsTab={nav.setModelsTab} />;
      }
      case 'Tools & MCP': {
        const C = SECTION_LOADERS['Tools & MCP'];
        return <C data={data} activeSection={resolvedLabel} />;
      }
      case 'Rules & Skills': {
        const C = SECTION_LOADERS['Rules & Skills'];
        return (
          <C
            data={data}
            rulesSkillsTab={nav.rulesSkillsTab}
            setRulesSkillsTab={nav.setRulesSkillsTab}
          />
        );
      }
      case 'Workspace': {
        const C = SECTION_LOADERS.Workspace;
        return <C data={data} workspaceId={workspaceId} />;
      }
      case 'Brand & Design': {
        const C = SECTION_LOADERS['Brand & Design'];
        return <C workspaceId={workspaceId} />;
      }
      case 'Hooks': {
        const C = SECTION_LOADERS.Hooks;
        return <C data={data} />;
      }
      case 'GitHub': {
        const C = SECTION_LOADERS.GitHub;
        return <C repos={data.repos} workspaceId={workspaceId} />;
      }
      case 'Index Rules': {
        const C = SECTION_LOADERS['Index Rules'];
        return <C repos={data.repos} />;
      }
      case 'Integrations': {
        const C = SECTION_LOADERS.Integrations;
        return <C userId={data.profileEmail || null} workspaceId={workspaceId} onOpenInMonaco={onOpenInMonaco} />;
      }
      case 'CI/CD': {
        const C = SECTION_LOADERS['CI/CD'];
        return <C />;
      }
      case 'Network': {
        const C = SECTION_LOADERS.Network;
        return <C data={data} workspaceId={workspaceId} />;
      }
      case 'Themes': {
        const C = SECTION_LOADERS.Themes;
        return <C />;
      }
      case 'Storage': {
        const C = SECTION_LOADERS.Storage;
        return <C />;
      }
      case 'Keys & Secrets': {
        const C = SECTION_LOADERS['Keys & Secrets'];
        return <C workspaceId={workspaceId} />;
      }
      case 'Plan & Usage': {
        const C = SECTION_LOADERS['Plan & Usage'];
        return <C data={data} />;
      }
      case 'Notifications': {
        const C = SECTION_LOADERS.Notifications;
        return <C data={data} />;
      }
      case 'Docs': {
        const C = SECTION_LOADERS.Docs;
        return <C onOpenInMonaco={onOpenInMonaco} onFileSelect={onFileSelect} />;
      }
      default:
        return (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted">
            <Package size={28} className="opacity-30" />
            <p className="text-[12px]">{resolvedLabel} settings coming soon.</p>
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--dashboard-panel)] text-[var(--dashboard-text)] overflow-hidden">
      <div className="h-10 flex items-center justify-between px-4 border-b border-[var(--dashboard-border)] bg-[var(--dashboard-canvas)] shrink-0">
        <span className="font-semibold text-[12px] tracking-widest uppercase text-[var(--text-heading)]">
          Settings
        </span>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 hover:bg-[var(--bg-hover)] rounded transition-colors text-muted hover:text-[var(--text-heading)] text-[11px] uppercase tracking-wider"
        >
          Close
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {!nav.isMobile && (
          <div
            ref={nav.navRef}
            className="shrink-0 border-r border-[var(--dashboard-border)] flex flex-col overflow-hidden relative"
            style={{ width: nav.navWidth }}
          >
            <div
              className={`flex items-center border-b border-[var(--dashboard-border)] ${
                nav.navCollapsed ? 'justify-center px-2 py-3' : 'gap-2.5 px-3 py-3'
              }`}
            >
              <div className="w-7 h-7 rounded-full bg-[var(--solar-blue)] flex items-center justify-center text-[var(--toggle-knob)] font-bold text-[11px] shrink-0">
                {initialsFromDisplayName(data.profileDisplayName)}
              </div>
              {!nav.navCollapsed ? (
                <div className="flex flex-col min-w-0">
                  <span className="text-[11px] font-semibold text-[var(--text-heading)] truncate">
                    {data.profileDisplayName || data.profileEmail || '—'}
                  </span>
                  <span className="text-[10px] text-[var(--solar-cyan)] truncate">
                    {formatPlanLabel(data.profilePlan)}
                  </span>
                </div>
              ) : null}
            </div>

            <SectionNav
              sections={nav.menu}
              activeSection={resolvedLabel}
              onSelect={handleSectionSelect}
              collapsed={nav.navCollapsed}
            />

            <div className="shrink-0 border-t border-[var(--dashboard-border)] p-2">
              <button
                type="button"
                title={nav.navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
                aria-expanded={!nav.navCollapsed}
                onClick={nav.toggleNavCollapsed}
                className={`flex w-full min-h-[36px] items-center rounded-lg text-muted hover:text-main hover:bg-[var(--bg-hover)] transition-colors ${
                  nav.navCollapsed ? 'justify-center px-0' : 'gap-2 px-2'
                }`}
              >
                {nav.navCollapsed ? (
                  <PanelLeft size={16} strokeWidth={1.5} />
                ) : (
                  <>
                    <PanelLeftClose size={16} strokeWidth={1.5} />
                    <span className="text-[11px]">Collapse</span>
                  </>
                )}
              </button>
            </div>

            {!nav.navCollapsed ? (
              <div
                onMouseDown={nav.onNavDragStart}
                className="absolute top-0 right-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-[var(--border-subtle)]"
              />
            ) : null}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
          {nav.isMobile && (
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="text-[12px] font-black uppercase tracking-widest text-[var(--text-heading)]">
                Section
              </div>
              <select
                value={resolvedLabel}
                onChange={(e) => handleSectionSelect(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl bg-[var(--dashboard-card)] border border-[var(--dashboard-border)] text-[12px] text-[var(--dashboard-text)]"
              >
                {nav.menu.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Suspense fallback={<SectionSkeleton />}>{sectionBody()}</Suspense>
        </div>
      </div>
    </div>
  );
}
