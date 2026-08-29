import {
  isAgentCenterChatHome,
  isAgentEditorPath,
  isAgentShellPath,
  isContextPreservingAgentRailPath,
} from './agentRoutes';

export type AgentChatLayout = 'center' | 'left-rail' | 'right-rail' | 'hidden';

/** Browser/CMS/code workbench tabs need side-rail chat — not center overlay on the canvas.
 *  Workspace-only on /agent|/new|/agent/{id} is NOT workbench-active (chat stays center).
 *  Stale browser tabs on those routes are reset by App — see UX-AGENT-CHAT-SURFACE-LAYOUT. */
export function isAgentWorkbenchSurfaceActive(opts: {
  hasActiveFile?: boolean;
  activeTab?: string;
  pathname?: string;
}): boolean {
  if (opts.hasActiveFile) return true;
  const tab = String(opts.activeTab || '').trim();
  if (tab === 'browser' || tab === 'cms' || tab === 'code') return true;
  // /dashboard/agent/editor is always a split workbench (Workspace + tabs), never center chat.
  if (opts.pathname && isAgentEditorPath(opts.pathname)) return true;
  return false;
}

export function resolveAgentChatLayout(opts: {
  pathname: string;
  search: string;
  agentPosition: 'off' | 'left' | 'right';
  isNarrow: boolean;
  isCmsFullscreen: boolean;
  /** True when /editor has an active file open — transitions chat to right rail. */
  hasActiveFile?: boolean;
  /** Active workbench tab — browser/cms also move chat to a side rail. */
  activeTab?: string;
}): AgentChatLayout {
  const { pathname, search, agentPosition, isNarrow, isCmsFullscreen, hasActiveFile, activeTab } = opts;
  const workbenchActive = isAgentWorkbenchSurfaceActive({ hasActiveFile, activeTab, pathname });
  if (isCmsFullscreen) {
    if (agentPosition === 'off') return 'hidden';
    if (isNarrow) return agentPosition === 'left' ? 'left-rail' : 'right-rail';
    if (agentPosition === 'left') return 'left-rail';
    return 'right-rail';
  }

  const centerChat = isAgentCenterChatHome(pathname, search);
  const editorRoute = isAgentEditorPath(pathname);

  // Center-chat routes (/dashboard/agent, /new, /c/*) use center layout when browsing.
  // When a code file is open, move chat to a side rail so Monaco is usable.
  if (centerChat && !editorRoute) {
    if (workbenchActive) {
      if (agentPosition === 'left') return 'left-rail';
      return 'right-rail';
    }
    return 'center';
  }

  // Editor route: always split-pane workbench — chat in side rail, never center overlay.
  if (editorRoute) {
    if (agentPosition === 'left') return 'left-rail';
    return 'right-rail';
  }

  if (agentPosition === 'left') return 'left-rail';
  if (agentPosition === 'right') return 'right-rail';

  if (isAgentShellPath(pathname) || isContextPreservingAgentRailPath(pathname)) {
    return agentPosition === 'off' ? 'hidden' : 'right-rail';
  }

  return 'hidden';
}

/**
 * Hide empty Monaco trap on agent home / conversation — editor only when a file is open.
 * On /editor with no file, show EditorWorkbenchLanes — not Monaco or center chat.
 */
export function shouldShowMonacoWorkbench(opts: {
  pathname: string;
  search: string;
  activeTab: string;
  hasActiveFile: boolean;
}): boolean {
  if (opts.activeTab !== 'code') return false;
  // Editor: Monaco only after user opens a file (explicit lane — not auto Untitled).
  if (isAgentEditorPath(opts.pathname)) return opts.hasActiveFile;
  if (opts.hasActiveFile) return true;
  if (isAgentCenterChatHome(opts.pathname, opts.search)) return false;
  return true;
}

export function shouldShowAgentWorkbenchTabs(opts: {
  pathname: string;
  search: string;
  hasActiveFile?: boolean;
  activeTab?: string;
}): boolean {
  const workbenchActive = isAgentWorkbenchSurfaceActive({
    hasActiveFile: opts.hasActiveFile,
    activeTab: opts.activeTab,
    pathname: opts.pathname,
  });
  const tab = String(opts.activeTab || '').trim();
  if (isAgentCenterChatHome(opts.pathname, opts.search)) {
    // Atmospheric home hides tabs until browser/cms/code surface is engaged.
    return workbenchActive && tab !== 'Workspace';
  }
  // Editor always shows workbench tabs (Workspace, Browser, Code, …).
  if (isAgentEditorPath(opts.pathname)) return true;
  return true;
}
