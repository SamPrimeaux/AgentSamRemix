/** Shell new-chat / history / draw / sketch actions (Wave 2). */
import React, { useCallback } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import {
  AGENT_NEW_CHAT_PATH,
  isAgentEditorPath,
  isAgentNewChatPath,
  isAgentShellPath,
  isContextPreservingAgentRailPath,
} from '../lib/agentRoutes';
import { SKETCH_PATH } from '../pages/sketch/sketchRoutes';
import { IAM_AGENT_CHAT_CONVERSATION_CHANGE } from '../agentChatConstants';
import {
  openAgentConversation,
  resumeAgentChatSession,
} from '../lib/openAgentConversation';
import type { AgentPanelPosition } from './useAppPanelLayout';

export function useAppShellChatActions(opts: {
  createNewAgentChatTabRef: React.MutableRefObject<(() => void) | null | undefined>;
  locationPathname: string;
  navigate: NavigateFunction;
  isAgentHomeAtmospheric: boolean;
  isNarrowViewport: boolean;
  ensureAgentSidePanel: () => void;
  agentPosition: AgentPanelPosition;
  setAgentPosition: React.Dispatch<React.SetStateAction<AgentPanelPosition>>;
  activeAgentConversationId: string | null | undefined;
}) {
  const {
    createNewAgentChatTabRef, locationPathname, navigate, isAgentHomeAtmospheric,
    isNarrowViewport, ensureAgentSidePanel, agentPosition, setAgentPosition,
    activeAgentConversationId,
  } = opts;

  const shellNewChat = useCallback(() => {
    createNewAgentChatTabRef.current?.();
    if (isAgentEditorPath(locationPathname)) {
      if (agentPosition === 'off') setAgentPosition('right');
      return;
    }
    // Work / Collaborate / Projects / Mail: keep the current route; only open the side rail.
    // Navigating to /dashboard/agent/new was yanking users out of context into a "fresh" agent home.
    if (isContextPreservingAgentRailPath(locationPathname)) {
      if (agentPosition === 'off') setAgentPosition('right');
      return;
    }
    if (!isAgentShellPath(locationPathname)) {
      navigate(AGENT_NEW_CHAT_PATH);
    } else if (!isAgentNewChatPath(locationPathname)) {
      navigate(AGENT_NEW_CHAT_PATH, { replace: true });
    }
    if (isAgentHomeAtmospheric && !isNarrowViewport) return;
    ensureAgentSidePanel();
  }, [locationPathname, navigate, isAgentHomeAtmospheric, isNarrowViewport, ensureAgentSidePanel, agentPosition]);

  const shellOpenChats = useCallback(() => {
    navigate('/dashboard/chats');
  }, [navigate]);

  const shellOpenChatHistory = useCallback(() => {
    navigate('/dashboard/chats');
  }, [navigate]);

  const shellSelectChat = useCallback(
    (conversationId: string, title?: string) => {
      const id = String(conversationId || '').trim();
      if (!id) return;
      // On Work / Collaborate / Projects / Mail: resume in the side rail — do not full-screen navigate.
      if (isContextPreservingAgentRailPath(locationPathname)) {
        openAgentConversation({ id, title, force: true });
        if (agentPosition === 'off') setAgentPosition('right');
        return;
      }
      resumeAgentChatSession({ id, title, force: true });
    },
    [locationPathname, agentPosition],
  );

  const shellDeleteActiveChat = useCallback(
    (deletedId: string) => {
      const id = String(deletedId || '').trim();
      if (!id || id !== activeAgentConversationId) return;
      createNewAgentChatTabRef.current?.();
      window.dispatchEvent(new CustomEvent(IAM_AGENT_CHAT_CONVERSATION_CHANGE, { detail: { id: null } }));
    },
    [activeAgentConversationId],
  );

  const shellOpenMovieMode = useCallback(() => {
    navigate('/dashboard/moviemode');
  }, [navigate]);

  const shellOpenDraw = useCallback(
    (detail?: { load_url?: string | null; artifact_id?: string | null }) => {
      navigate('/dashboard/draw');
      const load = detail?.load_url?.trim() || '';
      const aid = detail?.artifact_id?.trim() || '';
      if (load || aid) {
        queueMicrotask(() => {
          window.dispatchEvent(
            new CustomEvent('iam:excalidraw_load_document', {
              detail: {
                load_url: load || null,
                artifact_id: aid || null,
                replace_workspace: true,
              },
            }),
          );
        });
      }
    },
    [navigate],
  );

  const shellOpenSketch = useCallback(
    (detail?: {
      elements?: unknown[];
      mode?: 'sketch' | 'layout' | 'blueprint';
      name?: string;
    }) => {
      navigate(SKETCH_PATH);
      if (detail?.elements?.length) {
        queueMicrotask(() => {
          window.dispatchEvent(
            new CustomEvent('iam:sketch_load_document', {
              detail: {
                elements: detail.elements,
                mode: detail.mode ?? 'layout',
                name: detail.name ?? 'Agent concept',
              },
            }),
          );
        });
      }
    },
    [navigate],
  );

  return {
    shellNewChat, shellOpenChats, shellOpenChatHistory, shellSelectChat,
    shellDeleteActiveChat, shellOpenMovieMode, shellOpenDraw, shellOpenSketch,
  };
}
