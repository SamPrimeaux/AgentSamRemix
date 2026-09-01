import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { 
  X, 
  ChevronRight, 
  ChevronDown, 
  PanelLeftClose, 
  PanelLeftOpen, 
  Check, 
  ChevronsUpDown,
  Search,
  Sliders,
  FolderGit2,
  GitBranch,
  ShieldCheck,
  Server,
  Zap,
  Terminal,
  Sun,
  Moon,
  Sparkles,
  ArrowLeft
} from 'lucide-react';
import { cn } from '../../../lib/utils';

export type SidebarState = 'expanded' | 'collapsed' | 'peeking';
export type SidebarSurface = 'main' | 'workspaces' | 'diagnostics' | 'settings';

interface SidebarContextValue {
  state: SidebarState;
  isOpen: boolean; // Mobile / Drawer open
  isCollapsed: boolean; // Desktop collapsed rail
  isPeeking: boolean;
  activeSurface: SidebarSurface;
  setActiveSurface: (surface: SidebarSurface) => void;
  setIsOpen: (open: boolean) => void;
  setIsCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  toggleCollapse: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error('useSidebar must be used within a <Sidebar.Provider>');
  }
  return ctx;
}

export interface SidebarProviderProps {
  children: ReactNode;
  defaultOpen?: boolean;
  defaultCollapsed?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SidebarProvider({
  children,
  defaultOpen = false,
  defaultCollapsed = false,
  onOpenChange
}: SidebarProviderProps) {
  const [isOpen, setIsOpenState] = useState(defaultOpen);
  const [isCollapsed, setIsCollapsedState] = useState(defaultCollapsed);
  const [isPeeking, setIsPeeking] = useState(false);
  const [activeSurface, setActiveSurface] = useState<SidebarSurface>('main');

  const setIsOpen = (open: boolean) => {
    setIsOpenState(open);
    if (onOpenChange) onOpenChange(open);
  };

  const setIsCollapsed = (collapsed: boolean) => {
    setIsCollapsedState(collapsed);
  };

  const toggleSidebar = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setIsOpenState(prev => !prev);
    } else {
      setIsCollapsedState(prev => !prev);
    }
  };
  const toggleCollapse = () => setIsCollapsedState(prev => !prev);
  const openDrawer = () => setIsOpenState(true);
  const closeDrawer = () => setIsOpenState(false);

  // Keyboard shortcut: Cmd/Ctrl + B to toggle drawer/rail
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        if (window.innerWidth < 1024) {
          setIsOpenState(prev => !prev);
        } else {
          setIsCollapsedState(prev => !prev);
        }
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const state: SidebarState = isPeeking ? 'peeking' : isCollapsed ? 'collapsed' : 'expanded';

  return (
    <SidebarContext.Provider
      value={{
        state,
        isOpen,
        isCollapsed,
        isPeeking,
        activeSurface,
        setActiveSurface,
        setIsOpen,
        setIsCollapsed,
        toggleSidebar,
        toggleCollapse,
        openDrawer,
        closeDrawer
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

// ----------------------------------------------------
// Main Sidebar Component
// ----------------------------------------------------
export interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  children: ReactNode;
  className?: string;
  variant?: 'floating' | 'inset' | 'docked';
  side?: 'left' | 'right';
}

export function Sidebar({
  children,
  className,
  variant = 'docked',
  side = 'left',
  ...props
}: SidebarProps) {
  const { isOpen, isCollapsed, closeDrawer } = useSidebar();

  return (
    <>
      {/* Mobile Backdrop Modal Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs transition-opacity lg:hidden"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}

      {/* Responsive Sidebar Container:
          On mobile (<1024px): slides in as fixed drawer when isOpen=true.
          On desktop (>=1024px): sits in standard flex layout or docked rail. */}
      <aside
        aria-label="Navigation Sidebar"
        className={cn(
          "bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col z-50 lg:z-30 transition-all duration-200 ease-in-out select-none",
          // Mobile Drawer Styles:
          "fixed top-0 bottom-0 left-0 w-80 max-w-[85vw] shadow-2xl lg:shadow-none",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          // Desktop Docked Styles:
          "lg:relative lg:top-auto lg:bottom-auto lg:h-full shrink-0",
          isCollapsed ? "lg:w-16" : "lg:w-72",
          className
        )}
        {...props}
      >
        {children}
      </aside>
    </>
  );
}

// ----------------------------------------------------
// Sidebar Header
// ----------------------------------------------------
export interface SidebarHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export function SidebarHeader({ children, className, ...props }: SidebarHeaderProps) {
  return (
    <div 
      className={cn(
        "p-3.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/40 flex flex-col gap-2 shrink-0",
        className
      )} 
      {...props}
    >
      {children}
    </div>
  );
}

// ----------------------------------------------------
// Sidebar Content
// ----------------------------------------------------
export interface SidebarContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export function SidebarContent({ children, className, ...props }: SidebarContentProps) {
  return (
    <div 
      className={cn(
        "flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-4 scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-800",
        className
      )} 
      {...props}
    >
      {children}
    </div>
  );
}

// ----------------------------------------------------
// Sidebar Footer
// ----------------------------------------------------
export interface SidebarFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export function SidebarFooter({ children, className, ...props }: SidebarFooterProps) {
  return (
    <div 
      className={cn(
        "p-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/80 flex flex-col gap-2 shrink-0",
        className
      )} 
      {...props}
    >
      {children}
    </div>
  );
}

// ----------------------------------------------------
// Sidebar Group & Menu Elements
// ----------------------------------------------------
export interface SidebarGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export function SidebarGroup({ children, className, ...props }: SidebarGroupProps) {
  return (
    <div className={cn("space-y-1", className)} {...props}>
      {children}
    </div>
  );
}

export interface SidebarGroupLabelProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  badge?: string;
}

export function SidebarGroupLabel({ children, badge, className, ...props }: SidebarGroupLabelProps) {
  const { isCollapsed } = useSidebar();
  if (isCollapsed) return null;

  return (
    <div 
      className={cn(
        "text-[10.5px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 px-2 py-1 flex items-center justify-between",
        className
      )} 
      {...props}
    >
      <span className="truncate">{children}</span>
      {badge && (
        <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
          {badge}
        </span>
      )}
    </div>
  );
}

export interface SidebarMenuProps extends React.HTMLAttributes<HTMLUListElement> {
  children: ReactNode;
  className?: string;
}

export function SidebarMenu({ children, className, ...props }: SidebarMenuProps) {
  return (
    <ul className={cn("space-y-1 list-none p-0 m-0", className)} {...props}>
      {children}
    </ul>
  );
}

export interface SidebarMenuItemProps extends React.HTMLAttributes<HTMLLIElement> {
  children: ReactNode;
  className?: string;
}

export function SidebarMenuItem({ children, className, ...props }: SidebarMenuItemProps) {
  return (
    <li className={cn("relative", className)} {...props}>
      {children}
    </li>
  );
}

export interface SidebarMenuButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive?: boolean;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  sublabel?: string;
  tooltip?: string;
  className?: string;
}

export function SidebarMenuButton({
  isActive = false,
  icon,
  badge,
  sublabel,
  tooltip,
  children,
  className,
  ...props
}: SidebarMenuButtonProps) {
  const { isCollapsed } = useSidebar();

  return (
    <button
      type="button"
      title={tooltip || (typeof children === 'string' ? children : undefined)}
      className={cn(
        "w-full text-left rounded-xl text-xs transition-all duration-150 flex items-center group relative min-h-[44px] cursor-pointer active:scale-[0.98] touch-manipulation",
        isCollapsed ? "justify-center p-2.5" : "justify-between p-2.5",
        isActive
          ? "bg-zinc-900 dark:bg-zinc-800 text-white font-bold shadow-xs border border-zinc-900 dark:border-zinc-700"
          : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 font-medium border border-transparent",
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {icon && (
          <div className={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors",
            isActive
              ? "bg-emerald-500 text-white"
              : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700"
          )}>
            {icon}
          </div>
        )}
        {!isCollapsed && (
          <div className="min-w-0 truncate">
            <div className="truncate text-xs font-semibold leading-tight">{children}</div>
            {sublabel && (
              <div className={cn(
                "text-[10px] truncate mt-0.5 leading-none",
                isActive ? "text-zinc-300" : "text-zinc-400 dark:text-zinc-500"
              )}>
                {sublabel}
              </div>
            )}
          </div>
        )}
      </div>

      {!isCollapsed && (
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {badge && (
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-md font-mono font-medium",
              isActive
                ? "bg-zinc-800 dark:bg-zinc-700 text-zinc-200"
                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
            )}>
              {badge}
            </span>
          )}
          <ChevronRight 
            size={13} 
            className={cn(
              "transition-transform",
              isActive ? "text-white" : "text-zinc-400 group-hover:translate-x-0.5"
            )} 
          />
        </div>
      )}
    </button>
  );
}

// ----------------------------------------------------
// Collapsible Section
// ----------------------------------------------------
export interface SidebarCollapsibleProps {
  title: string;
  icon?: React.ReactNode;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

export function SidebarCollapsible({
  title,
  icon,
  badge,
  defaultOpen = true,
  children,
  className
}: SidebarCollapsibleProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const { isCollapsed } = useSidebar();

  if (isCollapsed) {
    return <div className="space-y-1">{children}</div>;
  }

  return (
    <div className={cn("space-y-1", className)}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-md transition-colors"
      >
        <div className="flex items-center gap-1.5 truncate">
          {icon && <span className="text-zinc-400">{icon}</span>}
          <span>{title}</span>
        </div>
        <div className="flex items-center gap-1">
          {badge && (
            <span className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
              {badge}
            </span>
          )}
          <ChevronDown 
            size={13} 
            className={cn("transition-transform duration-200", !isOpen && "-rotate-90")} 
          />
        </div>
      </button>
      {isOpen && <div className="space-y-1 pl-1">{children}</div>}
    </div>
  );
}

// ----------------------------------------------------
// Sliding Views System (Multi-surface navigation in sidebar)
// ----------------------------------------------------
export interface SidebarSlidingViewsProps {
  activeView: SidebarSurface;
  children: ReactNode;
  className?: string;
}

export function SidebarSlidingViews({
  activeView,
  children,
  className
}: SidebarSlidingViewsProps) {
  return (
    <div className={cn("relative w-full h-full overflow-hidden", className)}>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement(child)) return null;
        const childElement = child as React.ReactElement<{ viewId?: string }>;
        if (childElement.props.viewId !== activeView) return null;
        return child;
      })}
    </div>
  );
}

export interface SidebarSlidingViewProps {
  viewId: SidebarSurface;
  children: ReactNode;
  className?: string;
}

export function SidebarSlidingView({ children, className }: SidebarSlidingViewProps) {
  return (
    <div className={cn("w-full h-full flex flex-col animate-in fade-in duration-150", className)}>
      {children}
    </div>
  );
}

// ----------------------------------------------------
// Account Switcher Dropdown
// ----------------------------------------------------
export interface SidebarAccountSwitcherProps {
  organization: string;
  tenantId: string;
  activePath: string;
  activeBranch: string;
  onSwitchWorkspace?: () => void;
  onOpenSettings?: () => void;
}

export function SidebarAccountSwitcher({
  organization,
  tenantId,
  activePath,
  activeBranch,
  onSwitchWorkspace,
  onOpenSettings
}: SidebarAccountSwitcherProps) {
  const { isCollapsed, setActiveSurface } = useSidebar();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className={cn(
          "w-full rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-white dark:bg-zinc-800/70 p-2 text-left flex items-center transition-all hover:bg-zinc-50 dark:hover:bg-zinc-800 group shadow-2xs",
          isCollapsed ? "justify-center" : "justify-between"
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-zinc-900 dark:bg-emerald-600 text-white font-extrabold text-xs flex items-center justify-center shrink-0 shadow-2xs">
            {organization.slice(0, 2).toUpperCase()}
          </div>
          {!isCollapsed && (
            <div className="min-w-0 truncate">
              <div className="font-extrabold text-xs text-zinc-900 dark:text-zinc-100 truncate flex items-center gap-1.5">
                <span>{organization}</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              </div>
              <div className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono truncate flex items-center gap-1 mt-0.5">
                <GitBranch size={10} className="text-violet-400 shrink-0" />
                <span className="truncate">{activeBranch}</span>
                <span className="text-zinc-300 dark:text-zinc-600">•</span>
                <span className="truncate">{tenantId}</span>
              </div>
            </div>
          )}
        </div>

        {!isCollapsed && (
          <ChevronsUpDown size={14} className="text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-200 shrink-0" />
        )}
      </button>

      {/* Account / Workspace Switcher Menu */}
      {dropdownOpen && !isCollapsed && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
          <div className="absolute top-full left-0 right-0 mt-1.5 z-50 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-1.5 shadow-xl space-y-1">
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Active Environment
            </div>
            <div className="p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-700/60 text-xs space-y-1">
              <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center justify-between">
                <span className="truncate font-mono">{activePath}</span>
                <ShieldCheck size={13} className="text-emerald-500 shrink-0" />
              </div>
              <div className="text-[10px] text-zinc-400 font-mono">Tenant: {tenantId}</div>
            </div>

            <button
              type="button"
              onClick={() => {
                setDropdownOpen(false);
                setActiveSurface('workspaces');
              }}
              className="w-full text-left px-2 py-1.5 rounded-lg text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/80 flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <FolderGit2 size={13} className="text-blue-500" />
                <span>Switch Repository / Workspace</span>
              </div>
              <ChevronRight size={12} className="text-zinc-400" />
            </button>

            <button
              type="button"
              onClick={() => {
                setDropdownOpen(false);
                setActiveSurface('diagnostics');
              }}
              className="w-full text-left px-2 py-1.5 rounded-lg text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700/80 flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <Server size={13} className="text-amber-500" />
                <span>ExecOS & Daemon Status</span>
              </div>
              <ChevronRight size={12} className="text-zinc-400" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------
// Triggers & Toggles
// ----------------------------------------------------
export function SidebarTrigger({ className }: { className?: string }) {
  const { isCollapsed, toggleCollapse, toggleSidebar } = useSidebar();

  const handleClick = () => {
    if (window.innerWidth < 1024) {
      toggleSidebar();
    } else {
      toggleCollapse();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Toggle navigation sidebar"
      title="Toggle navigation (⌘B)"
      className={cn(
        "min-w-[44px] min-h-[44px] w-11 h-11 rounded-2xl flex items-center justify-center text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-95 transition-all cursor-pointer touch-manipulation",
        className
      )}
    >
      {isCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
    </button>
  );
}

export function SidebarClose({ className }: { className?: string }) {
  const { closeDrawer } = useSidebar();
  return (
    <button
      type="button"
      onClick={closeDrawer}
      aria-label="Close navigation drawer"
      className={cn(
        "min-w-[44px] min-h-[44px] w-11 h-11 rounded-2xl flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 active:scale-95 transition-all cursor-pointer touch-manipulation",
        className
      )}
    >
      <X size={18} />
    </button>
  );
}

// Compound attachment
Sidebar.Provider = SidebarProvider;
Sidebar.Header = SidebarHeader;
Sidebar.Content = SidebarContent;
Sidebar.Footer = SidebarFooter;
Sidebar.Group = SidebarGroup;
Sidebar.GroupLabel = SidebarGroupLabel;
Sidebar.Menu = SidebarMenu;
Sidebar.MenuItem = SidebarMenuItem;
Sidebar.MenuButton = SidebarMenuButton;
Sidebar.Collapsible = SidebarCollapsible;
Sidebar.SlidingViews = SidebarSlidingViews;
Sidebar.SlidingView = SidebarSlidingView;
Sidebar.AccountSwitcher = SidebarAccountSwitcher;
Sidebar.Trigger = SidebarTrigger;
Sidebar.Close = SidebarClose;
