/** Explorer toggle / activity / problems→chat (Wave 2). */
import React, { useCallback, useEffect } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import {
  AGENT_EDITOR_PATH,
  AGENT_HOME_PATH,
  isAgentEditorPath,
  isAgentHomePath,
  isAgentShellPath,
} from '../lib/agentRoutes';
import {
  IAM_AGENT_CHAT_CONVERSATION_CHANGE,
  LS_AGENT_CHAT_CONVERSATION_ID,
} from '../agentChatConstants';
import type { AgentPanelPosition } from './useAppPanelLayout';

export function useAppExplorerActivity(opts: {
  locationPathname: string;
  navigate: NavigateFunction;
  isNarrowViewport: boolean;
  focusMobileCodeContext: () => void;
  engageAgentEditorWorkbench: () => void;
  setActiveActivity: React.Dispatch<React.SetStateAction<any>>;
  activeActivity: any;
  setIsTerminalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  terminalRef: React.RefObject<any>;
  setAgentPosition: React.Dispatch<React.SetStateAction<AgentPanelPosition>>;
  /** Reserved for callers; empty /editor no longer redirects away. */
  hasActiveFile?: boolean;
}) {
  const {
    locationPathname, navigate, isNarrowViewport, focusMobileCodeContext,
    engageAgentEditorWorkbench, setActiveActivity, activeActivity,
    setIsTerminalOpen, terminalRef, setAgentPosition,
  } = opts;

  useEffect(() => {
    // Editor mount: Workspace fills the canvas; chat stays in the side rail.
    // Monaco opens only when a file is selected.
    if (!isAgentEditorPath(locationPathname)) return;
    engageAgentEditorWorkbench();
    if (isNarrowViewport) {
      focusMobileCodeContext();
    }
  }, [locationPathname, focusMobileCodeContext, isNarrowViewport, engageAgentEditorWorkbench]);

  /**
   * Editor boot stays on Workspace / app library. Do not auto-open the first
   * durable recent (often README.md) — that stole the initial surface every
   * time /dashboard/agent/editor loaded. Users open files from Files / Cmd+K.
   */

  const toggleExplorer = useCallback(() => {
    if (!isAgentEditorPath(locationPathname)) {
      navigate(AGENT_EDITOR_PATH);
      engageAgentEditorWorkbench();
      setActiveActivity('files');
      return;
    }
    setActiveActivity((prev) => (prev === 'files' ? null : 'files'));
  }, [locationPathname, navigate, engageAgentEditorWorkbench, setActiveActivity]);

  useEffect(() => {
    if (!isAgentHomePath(locationPathname)) return;
    if (activeActivity === 'files') setActiveActivity(null);
  }, [locationPathname, activeActivity, setActiveActivity]);

  useEffect(() => {
    if (!isAgentShellPath(locationPathname)) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'b') return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      toggleExplorer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locationPathname, toggleExplorer]);

  const toggleActivity = (
    activity: 'files' | 'mcps' | 'git' | 'debug' | 'actions' | 'drive',
  ) => {
    if (activity === 'files' && typeof window !== 'undefined') {
      const p = window.location.pathname;
      if (!isAgentShellPath(p) && p !== '/dashboard/meet') {
        navigate(AGENT_HOME_PATH);
      }
    }
    setActiveActivity((prev) => {
      if (prev === activity) return null;
      if (activity === 'debug') {
        setIsTerminalOpen(true);
        setTimeout(() => terminalRef.current?.setActiveTab('problems'), 50);
        return null; // Don't open a sidebar for debug anymore
      }
      return activity;
    });
  };

  const openAgentThreadFromProblems = useCallback((sessionId: string) => {
    const id = sessionId.trim();
    if (!id) return;
    try {
      localStorage.setItem(LS_AGENT_CHAT_CONVERSATION_ID, id);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent(IAM_AGENT_CHAT_CONVERSATION_CHANGE, { detail: { id } }));
    setAgentPosition((p) => (p === 'off' ? 'right' : p));
    setActiveActivity(null);
  }, [setAgentPosition, setActiveActivity]);


  return { toggleExplorer, toggleActivity, openAgentThreadFromProblems };
}
