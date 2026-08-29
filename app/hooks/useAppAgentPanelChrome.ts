/** Connection menu + agent chat layout / panel effects (Wave 2). */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { ConnectionMenuAction } from '../components/ConnectionMenuPanel';
import {
  IAM_TERMINAL_CONNECT,
  IAM_TERMINAL_SETUP_WIZARD,
  IAM_TERMINAL_CONFIGURE,
} from '../src/lib/openCommandPalette';
import { IAM_AGENT_PANEL_CHANGED } from '../lib/openAgentConversation';
import {
  isAgentCenterChatHome,
  isAgentEditorPath,
} from '../lib/agentRoutes';
import { resolveAgentChatLayout, shouldShowAgentWorkbenchTabs } from '../lib/shellLayoutMeta';
import type { ActiveFile } from '../types';
import type { MeetCtxValue } from '../src/MeetContext';
import type { AgentPanelPosition } from './useAppPanelLayout';

type ShellTabId = 'Workspace' | 'welcome' | 'code' | 'browser' | 'glb' | 'cms';

export function useAppAgentPanelChrome(opts: {
  navigate: NavigateFunction;
  setIsTerminalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setAgentBrowserPresenceActive: React.Dispatch<React.SetStateAction<boolean>>;
  isNarrowViewport: boolean;
  agentPosition: AgentPanelPosition;
  setAgentPosition: React.Dispatch<React.SetStateAction<AgentPanelPosition>>;
  LS_AGENT_POSITION: string;
  locationPathname: string;
  locationSearch: string;
  designStudioEntryPhase: boolean;
  drawEntryPhase: boolean;
  sketchEntryPhase: boolean;
  isCmsFullscreen: boolean;
  activeFile: ActiveFile | null;
  activeTab: ShellTabId;
  setActiveTab: React.Dispatch<React.SetStateAction<ShellTabId>>;
  isAgentEditorWorkbench: boolean;
  isAgentHomeAtmospheric: boolean;
  isCmsStudioEditor: boolean;
}) {
  const {
    navigate, setIsTerminalOpen, setAgentBrowserPresenceActive, isNarrowViewport,
    agentPosition, setAgentPosition, LS_AGENT_POSITION, locationPathname, locationSearch,
    designStudioEntryPhase, drawEntryPhase, sketchEntryPhase, isCmsFullscreen,
    activeFile, activeTab, setActiveTab, isAgentEditorWorkbench, isAgentHomeAtmospheric,
    isCmsStudioEditor,
  } = opts;

  const handleConnectionMenuAction = useCallback(
    (action: ConnectionMenuAction) => {
      if (action === 'ssh_config') {
        navigate('/dashboard/settings/network');
        return;
      }

      const openTerminalThen = (eventName: string, detail?: Record<string, string>) => {
        setIsTerminalOpen(true);
        setTimeout(() => {
          window.dispatchEvent(
            detail
              ? new CustomEvent(eventName, { detail })
              : new CustomEvent(eventName),
          );
        }, 100);
      };

      if (action === 'local_pty') {
        openTerminalThen(IAM_TERMINAL_CONNECT, { target: 'local' });
        return;
      }
      if (action === 'cloud_terminal') {
        openTerminalThen(IAM_TERMINAL_CONNECT, { target: 'cloud' });
        return;
      }
      if (action === 'gcp_vm') {
        openTerminalThen(IAM_TERMINAL_CONNECT, { target: 'sandbox' });
        return;
      }
      if (action === 'pty_setup_wizard') {
        openTerminalThen(IAM_TERMINAL_SETUP_WIZARD);
        return;
      }
      if (action === 'configure_terminal') {
        openTerminalThen(IAM_TERMINAL_CONFIGURE);
      }
    },
    [navigate],
  );

  /** Desktop: Draw / Search / History (Addendum A). */
  const [topChromeMoreOpen, setTopChromeMoreOpen] = useState(false);
  const topChromeMoreRef = useRef<HTMLDivElement>(null);
  const [isWorkspaceLauncherOpen, setWorkspaceLauncherOpen] = useState(false);

  const [meetCtxValue, setMeetCtxValue] = useState<MeetCtxValue | null>(null);

  const mobileSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  /** Mobile chat repo drawer: expand this repo when opening the GitHub / Deploy panel. */
  const [githubExpandRepo, setGithubExpandRepo] = useState<string | null>(null);

  useEffect(() => {
    const onBrowserPresence = (e: Event) => {
      const d = (e as CustomEvent<{ active?: boolean }>).detail;
      setAgentBrowserPresenceActive(d?.active === true);
    };
    window.addEventListener('iam-agent-browser-presence', onBrowserPresence);
    return () => window.removeEventListener('iam-agent-browser-presence', onBrowserPresence);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || isNarrowViewport) return;
    try {
      localStorage.setItem(LS_AGENT_POSITION, agentPosition);
    } catch {
      /* ignore */
    }
  }, [agentPosition, isNarrowViewport]);


  const agentChatLayout = useMemo(() => {
    if (locationPathname.startsWith('/dashboard/designstudio') && designStudioEntryPhase) {
      return 'center' as const;
    }
    if (locationPathname.startsWith('/dashboard/draw') && drawEntryPhase) {
      return 'center' as const;
    }
    if (locationPathname.startsWith('/dashboard/sketch') && sketchEntryPhase) {
      return 'center' as const;
    }
    return resolveAgentChatLayout({
      pathname: locationPathname,
      search: locationSearch,
      agentPosition,
      isNarrow: isNarrowViewport,
      isCmsFullscreen,
      hasActiveFile: !!activeFile,
      activeTab: String(activeTab),
    });
  }, [
    locationPathname,
    locationSearch,
    agentPosition,
    isNarrowViewport,
    isCmsFullscreen,
    designStudioEntryPhase,
    drawEntryPhase,
    sketchEntryPhase,
    activeFile,
    activeTab,
  ]);

  /** Atmospheric chrome only while chat actually owns the center — not when a side rail left an empty canvas. */
  const isCenterChatAtmospheric =
    !isAgentEditorWorkbench && isAgentHomeAtmospheric && agentChatLayout === 'center';

  /** Desktop center-chat routes keep layout=center — do not flip agentPosition to open a side rail. */
  const isCenterAgentDesktop = useMemo(
    () =>
      !isNarrowViewport &&
      (
        (isAgentCenterChatHome(locationPathname, locationSearch) && !isAgentEditorPath(locationPathname))
      ),
    [isNarrowViewport, locationPathname, locationSearch],
  );

  const ensureAgentSidePanel = useCallback(() => {
    if (isCenterAgentDesktop) return;
    setAgentPosition((p) => (p === 'off' ? 'right' : p));
  }, [isCenterAgentDesktop]);

  const showAgentWorkbenchTabs = useMemo(
    () => shouldShowAgentWorkbenchTabs({
      pathname: locationPathname,
      search: locationSearch,
      hasActiveFile: !!activeFile,
      activeTab: String(activeTab),
    }),
    [locationPathname, locationSearch, activeFile, activeTab],
  );

  useEffect(() => {
    if (!isCmsStudioEditor || isNarrowViewport) return;
    setAgentPosition('off');
  }, [isCmsStudioEditor, isNarrowViewport, locationPathname, locationSearch]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent(IAM_AGENT_PANEL_CHANGED, {
        detail: { open: agentPosition !== 'off' },
      }),
    );
  }, [agentPosition]);

  useEffect(() => {
    if (isNarrowViewport) return;
    if (!isAgentCenterChatHome(locationPathname, locationSearch)) return;
    if (isAgentEditorPath(locationPathname)) return;
    setAgentPosition('off');
  }, [locationPathname, locationSearch, isNarrowViewport]);

  /** Pure chat routes (/new, /agent/{id}): don't leave a hollow browser/cms/code canvas beside the rail. */
  useEffect(() => {
    if (!isAgentCenterChatHome(locationPathname, locationSearch)) return;
    if (isAgentEditorPath(locationPathname)) return;
    if (activeFile) return;
    setActiveTab((t) => (t === 'browser' || t === 'cms' || t === 'code' ? 'Workspace' : t));
  }, [locationPathname, locationSearch, activeFile]);

  return {
    handleConnectionMenuAction,
    topChromeMoreOpen, setTopChromeMoreOpen,
    topChromeMoreRef,
    isWorkspaceLauncherOpen, setWorkspaceLauncherOpen,
    meetCtxValue, setMeetCtxValue,
    mobileSwipeStartRef,
    githubExpandRepo, setGithubExpandRepo,
    agentChatLayout,
    isCenterChatAtmospheric,
    isCenterAgentDesktop,
    ensureAgentSidePanel,
    showAgentWorkbenchTabs,
  };
}
