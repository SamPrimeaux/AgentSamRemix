import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  FolderOpen,
  Github,
  ArrowRight,
  Target,
  Sparkles,
  ChevronDown,
  Zap,
  Globe,
  Search,
  History as HistoryIcon,
  Plus,
  Layout,
  MousePointer,
  FileText,
  Film,
  Square,
  GitBranch,
} from 'lucide-react';
import type { RecentFileEntry } from '../src/ideWorkspace';
import type { QuickstartTemplate } from './AgentQuickstartPage';
import { usePlanTasksRealtime } from '../src/hooks/usePlanTasksRealtime';
import { readRecentWorkspacesFromLocalStorage } from '../src/recentWorkspacesStorage';
import type { AgentHomeTab } from '../lib/agentRoutes';
import { AgentExamplesGalleryEmbed } from './AgentExamplesGalleryEmbed';
import { AppLibraryGrid } from './AppLibraryGrid';
import type { AppLibraryItem } from './AppLibraryGrid';

interface WorkspaceDashboardProps {
  onOpenFolder: () => void;
  onConnectWorkspace: () => void;
  onGithubSync: () => void;
  recentFiles: RecentFileEntry[];
  workspaceRows: Array<{ id: string; name: string }>;
  authWorkspaceId: string | null;
  onSwitchWorkspace: (id: string) => void;
  onQuickstart: () => void;
  activeAgentTab?: AgentHomeTab;
  onAgentTabChange?: (tab: AgentHomeTab) => void;
  onBeginTemplate?: (template: QuickstartTemplate) => void;
  onRunVerificationCommand?: (command: string) => void;
  onOpenEditor?: () => void;
  onOpenRecent: (entry: RecentFileEntry) => void;
  workspacePlanTasks?: unknown[];
  activePlanId?: string | null;
  workspaceActivity?: unknown[];
  workspaceVerificationCommands?: unknown[];
  activeAgentSlug?: string | null;
  sessionUserId?: string | null;
}

type NavTab = AgentHomeTab;

/** Per-card defaults when D1 quickstart templates do not override the slug. */
const CARD_QUICKSTART_DEFAULTS: Record<
  string,
  {
    seedMessage: string;
    task_type: string;
    route_key: string;
    openSurface?: 'excalidraw' | 'wireframe' | null;
  }
> = {
  'card-flowchart': {
    seedMessage:
      'Quickstart: Flowchart. The Excalidraw Draw canvas is open. Before drawing anything, ask me 2–4 short questions about the diagram I want (what process or system, who it is for, how many main nodes, any must-have labels or swimlanes). Wait for my answers. Then build it on the canvas with illustration_create (intent wireframe or sketch, engine excalidraw) and agentsam_excalidraw — never ASCII art or a text box diagram.',
    task_type: 'plan',
    route_key: 'design_studio',
    openSurface: 'excalidraw',
  },
  'card-wireframe': {
    seedMessage:
      'Quickstart: Product wireframe. Sketch is open in Layout mode. Before placing components, ask me 2–4 short questions: which screen(s), desktop/tablet/mobile, primary user goal, and any must-have blocks (nav, hero, form, table). Wait for my answers. Then guide me on the canvas or place a starter layout — do not output ASCII wireframes.',
    task_type: 'visual_canvas',
    route_key: 'visual_canvas',
    openSurface: 'wireframe',
  },
  'card-blank-canvas': {
    seedMessage:
      'Quickstart: Blank canvas. Sketch is open in Layout mode for a freeform interface concept. Ask what screen I want to design, then help me build it with the component palette.',
    task_type: 'visual_canvas',
    route_key: 'visual_canvas',
    openSurface: 'wireframe',
  },
};

const TEMPLATE_CARDS = [
  { id: 'start',     slug: 'start-anywhere',    icon: Plus,          label: 'Start anywhere',    sub: 'Add a file and design',    start: true },
  { id: 'slides',    slug: 'card-slides',        icon: Layout,        label: 'Slides',            sub: 'Decks & reviews' },
  { id: 'prototype', slug: 'card-prototype',     icon: MousePointer,  label: 'Prototype',         sub: 'Clickable & interactive' },
  { id: 'wireframe', slug: 'card-wireframe',     icon: Square,        label: 'Product wireframe', sub: 'Lo-fi screens & flows' },
  { id: 'doc',       slug: 'card-doc',           icon: FileText,      label: 'Doc',               sub: 'Resumes, PDFs, etc.' },
  { id: 'animation', slug: 'card-animation',     icon: Film,          label: 'Animation',         sub: 'Motion & video' },
  { id: 'blank',     slug: 'card-blank-canvas',  icon: Square,        label: 'Blank canvas',      sub: 'Start from scratch' },
  { id: 'flow',      slug: 'card-flowchart',     icon: GitBranch,     label: 'Flowchart',         sub: 'Diagrams & maps' },
  { id: 'component', slug: 'card-component-set', icon: Sparkles,      label: 'Component set',     sub: 'Reusable UI pieces' },
] as const;

function summarizeUnknownTask(row: unknown): string {
  if (row == null) return '';
  if (typeof row === 'string') return row;
  if (typeof row === 'object' && row !== null && 'title' in row && typeof (row as { title?: unknown }).title === 'string') {
    return String((row as { title: string }).title);
  }
  try { return JSON.stringify(row).slice(0, 200); } catch { return String(row); }
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const WorkspaceDashboardV2: React.FC<WorkspaceDashboardProps> = ({
  onOpenFolder,
  onConnectWorkspace,
  onGithubSync,
  recentFiles,
  workspaceRows,
  authWorkspaceId,
  onSwitchWorkspace,
  onQuickstart,
  activeAgentTab,
  onAgentTabChange,
  onBeginTemplate,
  onRunVerificationCommand,
  onOpenRecent,
  workspacePlanTasks = [],
  activePlanId = null,
  workspaceActivity = [],
  workspaceVerificationCommands = [],
  activeAgentSlug = null,
  sessionUserId = null,
}) => {
  const { tasks: realtimePlanTasks } = usePlanTasksRealtime(activePlanId ?? null);
  const displayPlanTasks: unknown[] = activePlanId ? (realtimePlanTasks as unknown[]) : workspacePlanTasks;

  const [activeNav, setActiveNav] = useState<NavTab>(activeAgentTab ?? 'recent');
  const [templateMap, setTemplateMap] = useState<Record<string, import('./AgentQuickstartPage').QuickstartTemplate>>({});

  useEffect(() => {
    if (!activeAgentTab) return;
    setActiveNav(activeAgentTab);
  }, [activeAgentTab]);

  const selectNavTab = (tab: NavTab) => {
    setActiveNav(tab);
    onAgentTabChange?.(tab);
  };

  useEffect(() => {
    fetch('/api/agent/quickstart/templates', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((body: {
        templates?: Array<
          import('./AgentQuickstartPage').QuickstartTemplate & {
            seed_message?: string;
            model_hint?: string;
            open_surface?: 'excalidraw' | 'wireframe' | null;
          }
        >;
      }) => {
        if (!Array.isArray(body.templates)) return;
        const map: Record<string, import('./AgentQuickstartPage').QuickstartTemplate> = {};
        for (const t of body.templates) {
          map[t.slug] = {
            id: t.id,
            slug: t.slug,
            name: t.name,
            description: t.description ?? '',
            modelHint: t.modelHint || t.model_hint || 'auto',
            seedMessage: t.seedMessage || t.seed_message || '',
            task_type: t.task_type || 'chat',
            route_key: t.route_key || 'chat',
            openSurface: t.openSurface ?? t.open_surface ?? null,
            subagentSlug: t.subagentSlug,
            subagentProfileId: t.subagentProfileId ?? null,
          };
        }
        setTemplateMap(map);
      })
      .catch(() => { /* silently fall back to hardcoded seeds */ });
  }, []);
  const [searchVal, setSearchVal] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const dirRef = useRef<number>(0);

  const recentWorkspaces = readRecentWorkspacesFromLocalStorage(sessionUserId);
  const activeWorkspace = workspaceRows.find((w) => w.id === authWorkspaceId);

  // edge-scroll
  const startScroll = (dir: number) => {
    dirRef.current = dir;
    const tick = () => {
      if (!dirRef.current || !scrollRef.current) return;
      scrollRef.current.scrollLeft += dirRef.current * 4;
      rafRef.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  };
  const stopScroll = () => {
    dirRef.current = 0;
    cancelAnimationFrame(rafRef.current);
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const hasStatusBanner =
    activeAgentSlug ||
    displayPlanTasks.length > 0 ||
    workspaceActivity.length > 0 ||
    workspaceVerificationCommands.length > 0;

  const allRecentRows: Array<{ key: string; name: string; sub: string; ts: number; onOpen: () => void }> = [
    ...recentWorkspaces.slice(0, 3).map((ws) => ({
      key: `ws-${ws.id}`,
      name: ws.display_name || ws.slug || ws.id,
      sub: `Workspace · ${ws.slug || ws.id}`,
      ts: ws.openedAt ?? 0,
      onOpen: () => onSwitchWorkspace(ws.id),
    })),
    ...recentFiles.slice(0, 8).map((f) => ({
      key: `f-${f.id}`,
      name: f.name,
      sub: f.label || f.workspacePath || '',
      ts: f.openedAt ?? 0,
      onOpen: () => onOpenRecent(f),
    })),
  ];

  const filteredRows = searchVal.trim()
    ? allRecentRows.filter(
        (r) =>
          r.name.toLowerCase().includes(searchVal.toLowerCase()) ||
          r.sub.toLowerCase().includes(searchVal.toLowerCase()),
      )
    : allRecentRows;

  const recentOpenedById = useMemo(() => {
    const m = new Map<string, number>();
    for (const ws of recentWorkspaces) {
      const ts =
        ws.updated_at != null && Number.isFinite(Number(ws.updated_at))
          ? Number(ws.updated_at) * (Number(ws.updated_at) > 1e12 ? 1 : 1000)
          : 0;
      m.set(ws.id, ts);
    }
    return m;
  }, [recentWorkspaces]);

  const workspaceLibraryItems: AppLibraryItem[] = useMemo(() => {
    return workspaceRows.map((ws) => {
      const ts = recentOpenedById.get(ws.id) ?? 0;
      return {
        id: ws.id,
        name: ws.name,
        subtitle: authWorkspaceId === ws.id ? 'Active workspace' : 'Workspace',
        active: authWorkspaceId === ws.id,
        lastViewedLabel: ts ? timeAgo(ts) : '—',
        onOpen: () => onSwitchWorkspace(ws.id),
      };
    });
  }, [workspaceRows, authWorkspaceId, recentOpenedById, onSwitchWorkspace]);

  const recentLibraryItems: AppLibraryItem[] = useMemo(() => {
    return filteredRows.map((row) => ({
      id: row.key,
      name: row.name,
      subtitle: row.sub,
      lastViewedLabel: row.ts ? timeAgo(row.ts) : '—',
      onOpen: row.onOpen,
    }));
  }, [filteredRows]);

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: 'var(--dashboard-canvas)', color: 'var(--dashboard-text)' }}
    >
      {/* ── TOP NAV ── */}
      <div
        className="shrink-0 flex items-center gap-6 px-8 border-b"
        style={{
          height: 52,
          background: 'var(--dashboard-panel)',
          borderColor: 'var(--dashboard-border)',
        }}
      >
        {/* Nav links */}
        <div className="flex items-center gap-1 flex-1">
          {(
            [
              { id: 'workspaces', label: 'Workspaces' },
              { id: 'recent',     label: 'Recent' },
              { id: 'examples',   label: 'Examples' },
            ] as { id: NavTab; label: string }[]
          ).map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => selectNavTab(n.id)}
              className="relative px-3 py-1.5 text-[13px] rounded-md transition-colors"
              style={{
                color: activeNav === n.id ? 'var(--dashboard-text)' : 'var(--text-muted)',
                fontWeight: activeNav === n.id ? 500 : 400,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {n.label}
              {activeNav === n.id && (
                <span
                  className="absolute left-3 right-3 rounded-t"
                  style={{
                    bottom: -13,
                    height: 2,
                    background: 'var(--dashboard-text)',
                    display: 'block',
                  }}
                />
              )}
            </button>
          ))}
        </div>


      </div>

      {/* ── BODY ── */}
      <div className="flex-1 overflow-y-auto no-scrollbar" style={{ position: 'relative' }}>

        {/* ── Examples gallery (inline on /dashboard/agent?tab=examples) ── */}
        {activeNav === 'examples' && (
          <div className="flex flex-col h-full min-h-0">
            <AgentExamplesGalleryEmbed />
          </div>
        )}

        {/* ── Normal body content ── */}
        {activeNav !== 'examples' && <div className="px-8 py-8">


        {/* Make something new */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-[14px] font-medium" style={{ color: 'var(--dashboard-text)' }}>
              Make something new
            </span>
            <button
              type="button"
              onClick={onConnectWorkspace}
              className="flex items-center gap-1 text-[12px] px-2 py-0.5 rounded"
              style={{
                border: '1px solid var(--dashboard-border)',
                color: 'var(--text-muted)',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              Workspace <ChevronDown size={10} />
            </button>
          </div>

          {/* Scrollable card strip */}
          <div className="relative">
            {/* left fade + scroll zone */}
            <div
              className="absolute left-0 top-0 bottom-0 z-10 pointer-events-none"
              style={{ width: 48, background: 'linear-gradient(to right, var(--dashboard-canvas), transparent)' }}
            />
            <div
              className="absolute left-0 top-0 bottom-0 z-20"
              style={{ width: 64, cursor: 'default' }}
              onMouseEnter={() => startScroll(-1)}
              onMouseLeave={stopScroll}
            />
            {/* right fade + scroll zone */}
            <div
              className="absolute right-0 top-0 bottom-0 z-10 pointer-events-none"
              style={{ width: 48, background: 'linear-gradient(to left, var(--dashboard-canvas), transparent)' }}
            />
            <div
              className="absolute right-0 top-0 bottom-0 z-20"
              style={{ width: 64, cursor: 'default' }}
              onMouseEnter={() => startScroll(1)}
              onMouseLeave={stopScroll}
            />

            <div
              ref={scrollRef}
              className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1"
              style={{ scrollBehavior: 'smooth' }}
            >
              {TEMPLATE_CARDS.map((card) => {
                const Icon = card.icon;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => {
                      if (onBeginTemplate) {
                        const fromApi = templateMap[card.slug];
                        const cardDefaults = CARD_QUICKSTART_DEFAULTS[card.slug];
                        onBeginTemplate({
                          id: `card_${card.id}`,
                          slug: card.slug,
                          name: card.label,
                          description: card.sub,
                          modelHint: fromApi?.modelHint ?? 'auto',
                          seedMessage:
                            fromApi?.seedMessage
                            ?? cardDefaults?.seedMessage
                            ?? `Quickstart: ${card.label}. Ask the user what they need before doing anything. Wait for answers before generating.`,
                          task_type: fromApi?.task_type ?? cardDefaults?.task_type ?? 'design_intake',
                          route_key: fromApi?.route_key ?? cardDefaults?.route_key ?? 'design_intake',
                          quickstart_card: card.slug,
                          openSurface: fromApi?.openSurface ?? cardDefaults?.openSurface ?? null,
                          subagentSlug: fromApi?.subagentSlug,
                          subagentProfileId: fromApi?.subagentProfileId ?? null,
                        });
                      } else {
                        onQuickstart();
                      }
                    }}
                    className="flex-none flex flex-col rounded-xl overflow-hidden transition-all text-left"
                    style={{
                      width: 148,
                      background: 'start' in card && card.start ? 'var(--dashboard-canvas)' : 'var(--dashboard-panel)',
                      border: 'start' in card && card.start
                        ? '1.5px dashed var(--dashboard-border)'
                        : '1px solid var(--dashboard-border)',
                      opacity: 'start' in card && card.start ? 0.75 : 1,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor = 'var(--text-muted)';
                      (e.currentTarget as HTMLElement).style.opacity = '1';
                    }}
                    onMouseLeave={(e) => {
                      const isStart = card.id === 'start';
                      (e.currentTarget as HTMLElement).style.borderColor = isStart ? 'var(--dashboard-border)' : 'var(--dashboard-border)';
                      (e.currentTarget as HTMLElement).style.opacity = isStart ? '0.75' : '1';
                    }}
                  >
                    {/* thumb */}
                    <div
                      className="flex items-center justify-center"
                      style={{
                        height: 96,
                        background: 'var(--dashboard-canvas)',
                        borderBottom: '1px solid var(--dashboard-border)',
                      }}
                    >
                      <Icon size={28} style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
                    </div>
                    {/* label */}
                    <div className="px-3 py-2.5">
                      <p className="text-[12px] font-medium leading-tight" style={{ color: 'var(--dashboard-text)' }}>{card.label}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{card.sub}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* App library — relevance-ranked cards (top 4), not a flat Designs/Workspaces table */}
        <div>
          <AppLibraryGrid
            title="App library"
            items={activeNav === 'workspaces' ? workspaceLibraryItems : recentLibraryItems}
            sessionUserId={sessionUserId}
            topN={4}
            onCreate={activeNav === 'workspaces' ? onConnectWorkspace : undefined}
            createLabel={activeNav === 'workspaces' ? 'Connect workspace' : undefined}
          />

          {/* Quick actions footer */}
          <div className="flex items-center gap-2 mt-4">
            <button
              type="button"
              onClick={onOpenFolder}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] transition-colors"
              style={{
                border: '1px solid var(--dashboard-border)',
                color: 'var(--text-muted)',
                background: 'transparent',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--dashboard-text)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
            >
              <FolderOpen size={13} /> Local folder
            </button>
            <button
              type="button"
              onClick={onGithubSync}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] transition-colors"
              style={{
                border: '1px solid var(--dashboard-border)',
                color: 'var(--text-muted)',
                background: 'transparent',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--dashboard-text)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
            >
              <Github size={13} /> Clone repo
            </button>
            <button
              type="button"
              onClick={onQuickstart}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] transition-colors"
              style={{
                border: '1px solid var(--dashboard-border)',
                color: 'var(--text-muted)',
                background: 'transparent',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--dashboard-text)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
            >
              <Zap size={13} /> Quickstart
            </button>
          </div>
        </div>
        </div>}{/* end activeNav !== examples */}
      </div>
    </div>
  );
};
