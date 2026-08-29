import { useCallback, useMemo, useState } from 'react';

export type ProtocolEvent = {
  time: string;
  type: string;
  message: string;
  payload?: Record<string, unknown>;
};

export type ProtocolArtifact = {
  id: string;
  name: string;
  kind: string;
  url?: string;
  created: number;
};

export type JobStatus =
  | 'ready'
  | 'routing'
  | 'generating_script'
  | 'script_ready'
  | 'executing'
  | 'preview_ready'
  | 'complete'
  | 'failed';

export type Toast = { id: string; title: string; note: string };

export function useCadStudioProtocol() {
  const [events, setEvents] = useState<ProtocolEvent[]>([]);
  const [artifacts, setArtifacts] = useState<ProtocolArtifact[]>([]);
  const [jobStatus, setJobStatus] = useState<JobStatus>('ready');
  const [statusMessage, setStatusMessage] = useState(
    'Select an object. Press Cmd/Ctrl K to run an operator.',
  );
  const [currentScript, setCurrentScript] = useState('');
  const [activeEngine, setActiveEngine] = useState('Blender');
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addEvent = useCallback((type: string, message: string, payload?: Record<string, unknown>) => {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    setEvents((prev) => [...prev, { time, type, message, payload }].slice(-64));
  }, []);

  const registerArtifact = useCallback((name: string, kind: string, url?: string) => {
    setArtifacts((prev) => {
      if (prev.some((a) => a.name === name)) return prev;
      return [
        ...prev,
        {
          id: `art_${Math.random().toString(36).slice(2, 10)}`,
          name,
          kind,
          url,
          created: Date.now(),
        },
      ];
    });
  }, []);

  const toast = useCallback((title: string, note: string) => {
    const id = `toast_${Date.now()}`;
    setToasts((prev) => [...prev, { id, title, note }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  const setStatus = useCallback((message: string, status?: JobStatus) => {
    setStatusMessage(message);
    if (status) setJobStatus(status);
  }, []);

  return useMemo(
    () => ({
      events,
      artifacts,
      jobStatus,
      statusMessage,
      currentScript,
      setCurrentScript,
      activeEngine,
      setActiveEngine,
      toasts,
      addEvent,
      registerArtifact,
      toast,
      setStatus,
    }),
    [
      events,
      artifacts,
      jobStatus,
      statusMessage,
      currentScript,
      activeEngine,
      toasts,
      addEvent,
      registerArtifact,
      toast,
      setStatus,
    ],
  );
}
