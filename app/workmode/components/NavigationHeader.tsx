import React, { useState, useRef, useEffect } from 'react';
import { 
  Menu, 
  Plus, 
  Sun, 
  Moon, 
  Smartphone, 
  Monitor, 
  Columns, 
  Sparkles, 
  GitBranch, 
  Terminal, 
  Server,
  FolderGit2,
  Home,
  Layers,
  MessageSquare
} from 'lucide-react';
import { AppMode, FlexLayoutMode, WorkSubTab } from '../types';
import { useWorkModeConfig } from '../context/WorkModeConfigContext';
import { Breadcrumbs } from './navigation/Breadcrumbs';
import { useSidebar } from './navigation/Sidebar';
import { cn } from '../../lib/utils';

interface NavigationHeaderProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
  workSubTab?: WorkSubTab;
  onWorkSubTabChange?: (tab: WorkSubTab) => void;
  onOpenMenu?: () => void;
  onQuickAction: () => void;
  onOpenTerminal?: () => void;
  isDarkMode: boolean;
  onToggleDarkMode: () => void;
  layoutMode: FlexLayoutMode;
  onLayoutModeChange: (m: FlexLayoutMode) => void;
  activeBranch?: string;
  activePath?: string;
}

export const NavigationHeader: React.FC<NavigationHeaderProps> = ({
  mode,
  onModeChange,
  workSubTab = 'workbench',
  onWorkSubTabChange,
  onOpenMenu,
  onQuickAction,
  onOpenTerminal,
  isDarkMode,
  onToggleDarkMode,
  layoutMode,
  onLayoutModeChange,
  activeBranch: propsActiveBranch,
  activePath: propsActivePath,
}) => {
  const { config } = useWorkModeConfig();
  const { toggleSidebar, openDrawer } = useSidebar();
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);

  const activeBranch = propsActiveBranch || config.defaultBranch;
  const activePath = propsActivePath || config.defaultPath;

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setIsPlusMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectView = (tabId: WorkSubTab) => {
    if (onWorkSubTabChange) {
      onWorkSubTabChange(tabId);
    }
    onModeChange('work');
  };

  const handleMenuTrigger = () => {
    if (onOpenMenu) {
      onOpenMenu();
    } else {
      openDrawer();
    }
  };

  const getSubTabLabel = (tab: WorkSubTab) => {
    switch (tab) {
      case 'workbench': return 'Agent Workbench';
      case 'presentations': return 'Presentations';
      case 'websites': return 'Websites & CMS';
      case 'dashboards': return 'Telemetry';
      case 'brand': return 'Brand Studio';
      case 'team': return 'Live Team';
      default: return 'Workbench';
    }
  };

  return (
    <header className="w-full px-3 sm:px-5 py-2 flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800/80 bg-white/90 dark:bg-zinc-950/90 backdrop-blur-md z-30 transition-colors shrink-0">
      {/* Left: Side Nav Trigger & Dynamic Breadcrumbs */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          id="btn-menu-drawer"
          onClick={handleMenuTrigger}
          aria-label="Open primary navigation sidebar"
          title="Open Side Nav (⌘B)"
          className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-2xl flex items-center justify-center bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-800 active:scale-95 transition-all shadow-2xs shrink-0 cursor-pointer touch-manipulation"
        >
          <Menu size={18} className="stroke-[2.2]" />
        </button>

        {/* Dynamic Breadcrumbs Navigation Hierarchy */}
        <div className="hidden md:flex items-center min-w-0">
          <Breadcrumbs size="sm">
            <Breadcrumbs.Link
              onClick={() => onModeChange('chat')}
              icon={<Home size={13} />}
              title="Return to Home"
            >
              {config.appName}
            </Breadcrumbs.Link>
            
            <Breadcrumbs.Separator />

            <Breadcrumbs.Link
              onClick={() => onModeChange('work')}
              icon={<FolderGit2 size={13} className="text-blue-500" />}
              title={activePath}
            >
              {activePath}
            </Breadcrumbs.Link>

            <Breadcrumbs.Separator />

            <Breadcrumbs.Current
              icon={mode === 'chat' ? <MessageSquare size={12} className="text-blue-500" /> : <Layers size={12} className="text-emerald-500" />}
            >
              {mode === 'chat' ? 'Chat Hub' : getSubTabLabel(workSubTab)}
            </Breadcrumbs.Current>

            <li className="ml-1 hidden xl:flex items-center gap-1">
              <Breadcrumbs.Clipboard text={activeBranch} label={activeBranch} />
            </li>
          </Breadcrumbs>
        </div>
      </div>

      {/* Center: Clean 2-Pill Segmented Navigation (Chat | Work) */}
      <nav aria-label="Main View Navigation" className="relative flex items-center bg-zinc-100/90 dark:bg-zinc-900/90 p-1 rounded-full border border-zinc-200/80 dark:border-zinc-800/80 shadow-2xs min-h-[44px]">
        {/* Tab 1: Chat */}
        <button
          id="btn-tab-chat"
          onClick={() => onModeChange('chat')}
          aria-label="Switch to Chat Mode"
          className={cn(
            "relative min-h-[38px] px-5 sm:px-6 py-1.5 rounded-full text-xs sm:text-[13px] font-semibold transition-all duration-200 z-10 flex items-center justify-center gap-1.5 active:scale-95 touch-manipulation cursor-pointer",
            mode === 'chat'
              ? "text-zinc-900 dark:text-zinc-950 font-bold"
              : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
          )}
        >
          {mode === 'chat' && (
            <span className="absolute inset-0 bg-white dark:bg-white rounded-full shadow-xs -z-10 transition-transform duration-200" />
          )}
          <span>Chat</span>
        </button>

        {/* Tab 2: Work */}
        <button
          id="btn-tab-work"
          onClick={() => onModeChange('work')}
          aria-label="Switch to Work Mode"
          className={cn(
            "relative min-h-[38px] px-5 sm:px-6 py-1.5 rounded-full text-xs sm:text-[13px] font-semibold transition-all duration-200 z-10 flex items-center justify-center gap-1.5 active:scale-95 touch-manipulation cursor-pointer",
            mode === 'work'
              ? "text-zinc-900 dark:text-zinc-950 font-bold"
              : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
          )}
        >
          {mode === 'work' && (
            <span className="absolute inset-0 bg-white dark:bg-white rounded-full shadow-xs -z-10 transition-transform duration-200" />
          )}
          <span className={cn("w-1.5 h-1.5 rounded-full transition-colors", mode === 'work' ? "bg-emerald-500" : "bg-zinc-400 dark:bg-zinc-600")} />
          <span>Work</span>
        </button>
      </nav>

      {/* Right: FlexFit Layout Switcher, Theme & Connect Plus Menu */}
      <div className="flex items-center gap-2 sm:gap-2.5">
        {/* FlexFit Layout Switcher (Visible on md and larger) */}
        <div className="hidden lg:flex items-center p-0.5 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs min-h-[44px]">
          <button
            onClick={() => onLayoutModeChange('split')}
            title="FlexFit Split View (Side-by-side)"
            className={cn(
              "px-3 py-1.5 min-h-[36px] rounded-full flex items-center gap-1 font-medium transition-all active:scale-95 cursor-pointer",
              layoutMode === 'split'
                ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs font-semibold"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
            )}
          >
            <Columns size={14} />
            <span className="hidden xl:inline">Split</span>
          </button>

          <button
            onClick={() => onLayoutModeChange('single')}
            title="Single Maximized View"
            className={cn(
              "px-3 py-1.5 min-h-[36px] rounded-full flex items-center gap-1 font-medium transition-all active:scale-95 cursor-pointer",
              layoutMode === 'single'
                ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs font-semibold"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
            )}
          >
            <Monitor size={14} />
            <span className="hidden xl:inline">Single</span>
          </button>

          <button
            onClick={() => onLayoutModeChange('phone')}
            title="Phone Preview Frame"
            className={cn(
              "px-3 py-1.5 min-h-[36px] rounded-full flex items-center gap-1 font-medium transition-all active:scale-95 cursor-pointer",
              layoutMode === 'phone'
                ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs font-semibold"
                : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white"
            )}
          >
            <Smartphone size={14} />
            <span className="hidden xl:inline">Phone</span>
          </button>
        </div>

        {/* Dark/Light Mode Toggle */}
        <button
          id="btn-toggle-theme"
          onClick={onToggleDarkMode}
          title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          aria-label="Toggle Color Theme"
          className="min-w-[44px] min-h-[44px] w-11 h-11 rounded-2xl flex items-center justify-center bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-800 active:scale-95 transition-all shadow-2xs shrink-0 cursor-pointer touch-manipulation"
        >
          {isDarkMode ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} />}
        </button>

        {/* Plus / Quick Connect Menu */}
        <div ref={plusMenuRef} className="relative">
          <button
            id="btn-quick-plus"
            onClick={() => setIsPlusMenuOpen(!isPlusMenuOpen)}
            title="Quick Connect & Action Menu"
            aria-label="Connect and Quick Actions"
            className={cn(
              "min-w-[44px] min-h-[44px] w-11 h-11 rounded-2xl flex items-center justify-center bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 active:scale-95 transition-all shadow-2xs shrink-0 cursor-pointer touch-manipulation",
              isPlusMenuOpen && "rotate-45"
            )}
          >
            <Plus size={18} className="stroke-[2.5] transition-transform duration-200" />
          </button>

          {/* Quick Connect & Action Menu Dropdown */}
          {isPlusMenuOpen && (
            <div className="absolute top-full right-0 mt-2 w-72 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl p-2 z-50 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
              <div className="px-3 py-1.5 text-[11px] font-semibold tracking-wider uppercase text-zinc-400 dark:text-zinc-500">
                Connect & Lanes
              </div>

              <div className="space-y-1">
                <button
                  onClick={() => {
                    setIsPlusMenuOpen(false);
                    if (onOpenTerminal) onOpenTerminal();
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-medium flex items-center gap-2.5 transition-colors"
                >
                  <div className="w-6 h-6 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
                    <Terminal size={13} />
                  </div>
                  <div>
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">Open Terminal Drawer</div>
                    <div className="text-[10px] text-zinc-400">Interactive shell & zsh logs</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setIsPlusMenuOpen(false);
                    handleSelectView('workbench');
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-medium flex items-center gap-2.5 transition-colors"
                >
                  <div className="w-6 h-6 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
                    <Server size={13} />
                  </div>
                  <div>
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">ExecOS Local Lane ({config.execOsPort})</div>
                    <div className="text-[10px] text-emerald-500 font-mono">Connected • 24ms • Port {config.execOsPort}</div>
                  </div>
                </button>

                <div className="my-1 border-t border-zinc-200 dark:border-zinc-800" />
                <div className="px-3 py-1 text-[11px] font-semibold tracking-wider uppercase text-zinc-400 dark:text-zinc-500">
                  Quick Actions
                </div>

                <button
                  onClick={() => {
                    setIsPlusMenuOpen(false);
                    onQuickAction();
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-medium flex items-center gap-2.5 transition-colors"
                >
                  <div className="w-6 h-6 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center shrink-0">
                    <Sparkles size={13} />
                  </div>
                  <div>
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">New Autonomous Task</div>
                    <div className="text-[10px] text-zinc-400">Prompt {config.appName} with AST context</div>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
