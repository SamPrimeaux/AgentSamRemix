import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { ProjectType } from '../../types';

export type DesignStudioChatContext = {
  activeProject: ProjectType;
  sceneId: string | null;
  blueprintId: string | null;
  cadJobId: string | null;
  sessionId: string | null;
  runId: string | null;
  /** Remote PTY compute: ready | running | degraded | unavailable */
  computeStatus: 'ready' | 'running' | 'degraded' | 'unavailable' | 'unknown';
  /** CAD Studio UI context for ChatAssistant orchestration */
  workspaceMode?: string | null;
  selectedObjectId?: string | null;
  panelLayout?: string | null;
  pendingOperator?: string | null;
};

type DesignStudioContextValue = DesignStudioChatContext & {
  setStudioContext: (patch: Partial<DesignStudioChatContext>) => void;
};

const defaultValue: DesignStudioContextValue = {
  activeProject: ProjectType.CAD,
  sceneId: null,
  blueprintId: null,
  cadJobId: null,
  sessionId: null,
  runId: null,
  computeStatus: 'unknown',
  workspaceMode: null,
  selectedObjectId: null,
  panelLayout: null,
  pendingOperator: null,
  setStudioContext: () => {},
};

const DesignStudioContext = createContext<DesignStudioContextValue>(defaultValue);

export function DesignStudioProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<DesignStudioContextValue, 'setStudioContext'>>({
    activeProject: ProjectType.CAD,
    sceneId: null,
    blueprintId: null,
    cadJobId: null,
    sessionId: null,
    runId: null,
    computeStatus: 'unknown',
    workspaceMode: null,
    selectedObjectId: null,
    panelLayout: null,
    pendingOperator: null,
  });

  const setStudioContext = useCallback((patch: Partial<DesignStudioChatContext>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo(
    () => ({ ...state, setStudioContext }),
    [state, setStudioContext],
  );

  return <DesignStudioContext.Provider value={value}>{children}</DesignStudioContext.Provider>;
}

export function useDesignStudioContext() {
  return useContext(DesignStudioContext);
}
