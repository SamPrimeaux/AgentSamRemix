import React, { useState } from 'react';
import { 
  X, 
  Layers, 
  FileText, 
  Layout, 
  BarChart3, 
  Palette, 
  Users, 
  Sun, 
  Moon, 
  Zap, 
  Terminal, 
  MessageSquare, 
  FolderGit2, 
  GitBranch, 
  ShieldCheck, 
  ChevronRight, 
  ArrowLeft,
  Server,
  Settings,
  Search,
  Activity,
  Sliders,
  Sparkles,
  ExternalLink,
  Code,
  HardDrive
} from 'lucide-react';
import { 
  Sidebar, 
  useSidebar, 
  SidebarSurface 
} from './Sidebar';
import { useWorkModeConfig } from '../../context/WorkModeConfigContext';
import { AppMode, WorkSubTab } from '../../types';
import { cn } from '../../../lib/utils';

export interface AppSidebarProps {
  currentMode?: AppMode;
  onModeChange?: (mode: AppMode) => void;
  currentWorkSubTab?: WorkSubTab;
  onWorkSubTabChange?: (tab: WorkSubTab) => void;
  onOpenTerminal?: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  activePath?: string;
  activeBranch?: string;
  onBranchChange?: (branch: string) => void;
  onSelectPreset: (prompt: string) => void;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  currentMode = 'work',
  onModeChange,
  currentWorkSubTab = 'workbench',
  onWorkSubTabChange,
  onOpenTerminal,
  isDarkMode,
  onToggleDarkMode,
  activePath: propsActivePath,
  activeBranch: propsActiveBranch,
  onBranchChange,
  onSelectPreset,
}) => {
  const { config, setActiveBranch, setActivePath } = useWorkModeConfig();
  const { activeSurface, setActiveSurface, isCollapsed, closeDrawer } = useSidebar();
  const [searchFilter, setSearchFilter] = useState('');

  const activePath = propsActivePath || config.defaultPath;
  const activeBranch = propsActiveBranch || config.defaultBranch;

  const handleNavigateMode = (mode: AppMode) => {
    if (onModeChange) onModeChange(mode);
    if (window.innerWidth < 1024) closeDrawer();
  };

  const handleNavigateWorkTab = (tab: WorkSubTab) => {
    if (onWorkSubTabChange) onWorkSubTabChange(tab);
    if (onModeChange) onModeChange('work');
    if (window.innerWidth < 1024) closeDrawer();
  };

  const studioViews: { id: WorkSubTab; label: string; icon: any; badge?: string; desc: string }[] = [
    { id: 'workbench', label: 'Agent Workbench', icon: Terminal, badge: 'Core', desc: 'Inbox, Workspaces, PRs & ExecOS Lane' },
    { id: 'presentations', label: 'Presentations Deck', icon: FileText, badge: '4 Slides', desc: 'Autonomous Client Pitch Deck' },
    { id: 'websites', label: 'Websites & CMS', icon: Layout, desc: 'Live Edge Sandbox & CMS Editor' },
    { id: 'dashboards', label: 'Telemetry Dashboards', icon: BarChart3, desc: 'Real-time agent metrics & pipeline' },
    { id: 'brand', label: 'Brand Studio', icon: Palette, badge: 'AI', desc: '1K Renders & Veo Motion Video' },
    { id: 'team', label: 'Live Collaboration', icon: Users, badge: '4 Swarms', desc: 'Multi-Agent Autonomous Team' },
  ];

  const quickPresets = [
    {
      title: 'Enterprise Q4 Pitch Deck',
      desc: 'Synthesize a 4-slide high-converting presentation deck with ROI models',
      prompt: `Synthesize a 4-slide enterprise pitch deck for ${config.clientBrandName} with Q4 financial roadmap and 4.2x ROI.`
    },
    {
      title: 'Responsive Client Landing Page',
      desc: 'Build a modern hero section, feature matrix, and pricing tiers',
      prompt: `Build a high-converting client landing page for ${config.clientBrandName} with responsive hero, value propositions, and enterprise pricing.`
    },
    {
      title: '1K Photorealistic Brand Assets',
      desc: 'Generate luxury showroom renders using gemini-3.1-flash-image',
      prompt: `Generate 1K brand assets using gemini-3.1-flash-image for ${config.clientBrandName} futuristic flagship showroom.`
    },
    {
      title: 'Cinematic Veo Video Teaser',
      desc: 'Generate a 16:9 1080p motion video using veo-3.1-fast-generate-preview',
      prompt: `Animate a 16:9 cinematic brand motion trailer for ${config.clientBrandName} using veo-3.1-fast-generate-preview.`
    },
    {
      title: 'Run Workspace Auth Tests',
      desc: 'Execute complete test suite & verify 18/18 assertions',
      prompt: 'Run the auth tests and fix any failures.'
    }
  ];

  const filteredStudioViews = studioViews.filter(v => 
    v.label.toLowerCase().includes(searchFilter.toLowerCase()) || 
    v.desc.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <Sidebar id="app-primary-sidebar">
      {/* 1. Header with Dynamic Account/Workspace Switcher & Mobile Close */}
      <Sidebar.Header>
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <Sidebar.AccountSwitcher
              organization={config.organization}
              tenantId={config.activeTenant}
              activePath={activePath}
              activeBranch={activeBranch}
            />
          </div>
          {/* Mobile close button only visible on mobile screen */}
          <div className="lg:hidden">
            <Sidebar.Close />
          </div>
          {/* Desktop collapse button */}
          {!isCollapsed && (
            <div className="hidden lg:block">
              <Sidebar.Trigger />
            </div>
          )}
        </div>

        {/* Quick Filter Search Bar (Desktop expanded & Mobile) */}
        {!isCollapsed && activeSurface === 'main' && (
          <div className="relative mt-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search studios & presets..."
              className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-white dark:bg-zinc-850 border border-zinc-200/80 dark:border-zinc-700/80 text-xs placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-hidden focus:ring-1 focus:ring-emerald-500 text-zinc-900 dark:text-zinc-100"
            />
            {searchFilter && (
              <button
                type="button"
                onClick={() => setSearchFilter('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}
      </Sidebar.Header>

      {/* 2. Sliding Views for Multi-Surface Depth */}
      <Sidebar.Content>
        <Sidebar.SlidingViews activeView={activeSurface}>
          {/* SURFACE 1: MAIN NAVIGATION */}
          <Sidebar.SlidingView viewId="main">
            <div className="space-y-4">
              {/* Primary Views (Chat vs Work Mode) */}
              <Sidebar.Group>
                <Sidebar.GroupLabel badge="2 Modes">Primary Views</Sidebar.GroupLabel>
                <div className={cn("grid gap-1.5", isCollapsed ? "grid-cols-1" : "grid-cols-2")}>
                  <button
                    type="button"
                    onClick={() => handleNavigateMode('chat')}
                    className={cn(
                      "rounded-xl border text-left flex transition-all duration-150 relative",
                      isCollapsed ? "p-2 items-center justify-center" : "p-2.5 flex-col justify-between",
                      currentMode === 'chat'
                        ? "bg-blue-500/10 border-blue-500/40 text-blue-900 dark:text-blue-200 shadow-2xs font-bold"
                        : "bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200/80 dark:border-zinc-700/60 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    )}
                    title="Chat Hub"
                  >
                    <div className="flex items-center justify-between w-full">
                      <MessageSquare size={16} className={currentMode === 'chat' ? "text-blue-500" : "text-zinc-400"} />
                      {currentMode === 'chat' && !isCollapsed && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                    </div>
                    {!isCollapsed && (
                      <div className="mt-1">
                        <div className="font-bold text-xs">Chat Hub</div>
                        <div className="text-[10px] text-zinc-400">Conversations</div>
                      </div>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleNavigateMode('work')}
                    className={cn(
                      "rounded-xl border text-left flex transition-all duration-150 relative",
                      isCollapsed ? "p-2 items-center justify-center" : "p-2.5 flex-col justify-between",
                      currentMode === 'work'
                        ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-900 dark:text-emerald-200 shadow-2xs font-bold"
                        : "bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200/80 dark:border-zinc-700/60 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    )}
                    title="Work Mode"
                  >
                    <div className="flex items-center justify-between w-full">
                      <Layers size={16} className={currentMode === 'work' ? "text-emerald-500" : "text-zinc-400"} />
                      {currentMode === 'work' && !isCollapsed && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                    </div>
                    {!isCollapsed && (
                      <div className="mt-1">
                        <div className="font-bold text-xs">Work Mode</div>
                        <div className="text-[10px] text-zinc-400">Studio & Tools</div>
                      </div>
                    )}
                  </button>
                </div>
              </Sidebar.Group>

              {/* Studio Workspaces (6 Modules) */}
              <Sidebar.Group>
                <Sidebar.GroupLabel badge={`${studioViews.length} Studios`}>Studio Workspaces</Sidebar.GroupLabel>
                <Sidebar.Menu>
                  {filteredStudioViews.map((view) => {
                    const Icon = view.icon;
                    const isActive = currentMode === 'work' && currentWorkSubTab === view.id;
                    return (
                      <Sidebar.MenuItem key={view.id}>
                        <Sidebar.MenuButton
                          isActive={isActive}
                          onClick={() => handleNavigateWorkTab(view.id)}
                          icon={<Icon size={14} />}
                          badge={view.badge}
                          sublabel={view.desc}
                          tooltip={view.label}
                        >
                          {view.label}
                        </Sidebar.MenuButton>
                      </Sidebar.MenuItem>
                    );
                  })}
                </Sidebar.Menu>
              </Sidebar.Group>

              {/* Workspace Details Trigger Card */}
              {!isCollapsed && (
                <div className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/80 dark:border-zinc-700/60 space-y-2">
                  <div className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
                    <span>Environment Context</span>
                    <span className="text-[10px] font-mono text-emerald-500 flex items-center gap-1 font-semibold">
                      <ShieldCheck size={11} /> Ready
                    </span>
                  </div>
                  <div className="text-xs font-mono text-zinc-800 dark:text-zinc-200 truncate flex items-center gap-1.5">
                    <FolderGit2 size={13} className="text-blue-500 shrink-0" />
                    <span className="truncate">{activePath}</span>
                  </div>
                  <div className="pt-2 border-t border-zinc-200/80 dark:border-zinc-700/80 flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1 font-mono text-zinc-600 dark:text-zinc-300">
                      <GitBranch size={11} className="text-violet-400" />
                      <strong>{activeBranch}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveSurface('diagnostics')}
                      className="text-blue-500 hover:text-blue-600 text-[10.5px] font-semibold flex items-center gap-0.5"
                    >
                      Diagnostics <ChevronRight size={10} />
                    </button>
                  </div>
                </div>
              )}

              {/* Developer Interactive Terminal Trigger */}
              {onOpenTerminal && (
                <Sidebar.Group>
                  <Sidebar.GroupLabel>Developer Utilities</Sidebar.GroupLabel>
                  <Sidebar.MenuItem>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.innerWidth < 1024) closeDrawer();
                        onOpenTerminal();
                      }}
                      className={cn(
                        "w-full text-left rounded-xl bg-zinc-900 dark:bg-black text-white border border-zinc-800 hover:border-zinc-700 flex items-center transition-all group",
                        isCollapsed ? "justify-center p-2.5" : "justify-between p-2.5"
                      )}
                      title="Interactive Terminal Drawer"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                          <Terminal size={14} />
                        </div>
                        {!isCollapsed && (
                          <div>
                            <div className="text-xs font-bold text-white group-hover:text-emerald-400 transition-colors">
                              Terminal Drawer
                            </div>
                            <div className="text-[10px] text-zinc-400 font-mono">
                              Port {config.execOsPort} • zsh
                            </div>
                          </div>
                        )}
                      </div>
                      {!isCollapsed && (
                        <ChevronRight size={13} className="text-zinc-500 group-hover:translate-x-0.5 transition-transform" />
                      )}
                    </button>
                  </Sidebar.MenuItem>
                </Sidebar.Group>
              )}

              {/* Quick Action Presets (Collapsible) */}
              {!isCollapsed && (
                <Sidebar.Collapsible
                  title="One-Click Presets"
                  icon={<Zap size={12} className="text-amber-500" />}
                  badge={`${quickPresets.length}`}
                  defaultOpen={true}
                >
                  <div className="space-y-1.5 pt-1">
                    {quickPresets.map((p, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          onSelectPreset(p.prompt);
                          if (window.innerWidth < 1024) closeDrawer();
                        }}
                        className="w-full text-left p-2.5 rounded-xl bg-white dark:bg-zinc-800/40 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-700/60 transition-colors space-y-0.5 group"
                      >
                        <div className="text-xs font-bold text-zinc-800 dark:text-zinc-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {p.title}
                        </div>
                        <div className="text-[10.5px] text-zinc-400 dark:text-zinc-500 line-clamp-1">{p.desc}</div>
                      </button>
                    ))}
                  </div>
                </Sidebar.Collapsible>
              )}
            </div>
          </Sidebar.SlidingView>

          {/* SURFACE 2: WORKSPACES REPOSITORY SELECTOR */}
          <Sidebar.SlidingView viewId="workspaces">
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setActiveSurface('main')}
                className="inline-flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                <ArrowLeft size={13} /> Back to Navigation
              </button>

              <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                Workspace Repositories
              </div>

              <div className="space-y-2">
                {[
                  { name: config.appName.toLowerCase(), repo: `${config.organization}/${config.appName.toLowerCase()}`, path: config.defaultPath, branch: config.defaultBranch, active: true },
                  { name: config.clientBrandName.toLowerCase(), repo: `${config.organization}/${config.clientBrandName.toLowerCase()}`, path: `projects/${config.clientBrandName.toLowerCase()}`, branch: 'main', active: false },
                  { name: 'iam-pwa-services', repo: `${config.organization}/iam-pwa-services`, path: 'services/pwa', branch: 'main', active: false },
                ].map((ws, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setActivePath(ws.path);
                      setActiveBranch(ws.branch);
                      setActiveSurface('main');
                    }}
                    className={cn(
                      "w-full text-left p-3 rounded-xl border transition-all",
                      ws.path === activePath
                        ? "bg-zinc-900 dark:bg-zinc-800 text-white border-zinc-900 dark:border-zinc-700"
                        : "bg-white dark:bg-zinc-850 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 text-zinc-800 dark:text-zinc-200"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs truncate">{ws.name}</span>
                      {ws.path === activePath && <ShieldCheck size={13} className="text-emerald-400" />}
                    </div>
                    <div className="text-[10.5px] font-mono text-zinc-400 truncate">{ws.repo}</div>
                    <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-2">
                      <span>branch: {ws.branch}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </Sidebar.SlidingView>

          {/* SURFACE 3: EXECOS & DAEMON DIAGNOSTICS */}
          <Sidebar.SlidingView viewId="diagnostics">
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setActiveSurface('main')}
                className="inline-flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                <ArrowLeft size={13} /> Back to Navigation
              </button>

              <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center justify-between">
                <span>ExecOS Environment Status</span>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>

              <div className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-850 border border-zinc-200/80 dark:border-zinc-700/80 space-y-2 text-xs font-mono">
                <div className="flex justify-between text-zinc-500 dark:text-zinc-400">
                  <span>Port</span>
                  <span className="text-zinc-900 dark:text-zinc-100 font-bold">{config.execOsPort}</span>
                </div>
                <div className="flex justify-between text-zinc-500 dark:text-zinc-400">
                  <span>User</span>
                  <span className="text-zinc-900 dark:text-zinc-100">{config.macUsername}</span>
                </div>
                <div className="flex justify-between text-zinc-500 dark:text-zinc-400">
                  <span>Tenant</span>
                  <span className="text-zinc-900 dark:text-zinc-100">{config.activeTenant}</span>
                </div>
                <div className="flex justify-between text-zinc-500 dark:text-zinc-400">
                  <span>Edge Region</span>
                  <span className="text-emerald-500 font-bold">{config.edgeRegion}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (onWorkSubTabChange) onWorkSubTabChange('workbench');
                  if (onModeChange) onModeChange('work');
                  setActiveSurface('main');
                }}
                className="w-full py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
              >
                <Server size={13} /> Inspect Local Execution Lane
              </button>
            </div>
          </Sidebar.SlidingView>
        </Sidebar.SlidingViews>
      </Sidebar.Content>

      {/* 3. Footer with Working Light/Dark Segmented Toggle & Developer Identity */}
      <Sidebar.Footer>
        {!isCollapsed ? (
          <div className="space-y-2.5">
            {/* Developer Identity Pill */}
            <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-white dark:bg-zinc-850 border border-zinc-200/80 dark:border-zinc-750">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0">
                  {config.developerInitials}
                </div>
                <div className="min-w-0 truncate">
                  <div className="font-bold text-xs text-zinc-900 dark:text-zinc-100 truncate">
                    {config.developerName}
                  </div>
                  <div className="text-[10px] text-zinc-400 truncate">
                    {config.developerEmail}
                  </div>
                </div>
              </div>
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="Online" />
            </div>

            {/* Light / Dark Mode Toggle with Crisp Styling */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center p-1 rounded-full bg-zinc-200/80 dark:bg-zinc-800 border border-zinc-300/80 dark:border-zinc-700/60">
                <button
                  type="button"
                  onClick={() => {
                    if (isDarkMode) onToggleDarkMode();
                  }}
                  title="Activate Light Mode"
                  className={cn(
                    "px-2.5 py-1 rounded-full flex items-center gap-1.5 text-xs font-semibold transition-all",
                    !isDarkMode
                      ? "bg-white text-zinc-900 shadow-xs"
                      : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  <Sun size={12} className={!isDarkMode ? "text-amber-500" : ""} />
                  <span>Light</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!isDarkMode) onToggleDarkMode();
                  }}
                  title="Activate Dark Mode"
                  className={cn(
                    "px-2.5 py-1 rounded-full flex items-center gap-1.5 text-xs font-semibold transition-all",
                    isDarkMode
                      ? "bg-zinc-900 text-zinc-100 shadow-xs"
                      : "text-zinc-500 hover:text-zinc-700"
                  )}
                >
                  <Moon size={12} className={isDarkMode ? "text-blue-400" : ""} />
                  <span>Dark</span>
                </button>
              </div>

              <Sidebar.Trigger />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={onToggleDarkMode}
              title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              {isDarkMode ? <Moon size={15} className="text-blue-400" /> : <Sun size={15} className="text-amber-500" />}
            </button>
            <Sidebar.Trigger />
          </div>
        )}
      </Sidebar.Footer>
    </Sidebar>
  );
};
