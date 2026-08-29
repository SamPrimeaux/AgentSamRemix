/** App shell terminal open/run/output bridge (Wave 2 E6). */
import React, { useCallback, useEffect, useRef } from 'react';
import type { XTermShellHandle, ShellTab } from '../components/XTermShell';
import { parseDevServerFromTerminalLine } from '../lib/resolvePreviewMode';
import type { DevServerState } from '../src/ideWorkspace';

/**
 * Host owns isTerminalOpen + shellOutputLines (early — agentWorkspaceContext
 * reads terminal_tail). This hook owns terminalRef, event bridges, and run helpers.
 */
export function useAppTerminalBridge(opts: {
  terminalDrawerH: number;
  setDevServer: React.Dispatch<React.SetStateAction<DevServerState | null>>;
  onDevServerUrlRef: React.MutableRefObject<((url: string) => void) | null>;
  isTerminalOpen: boolean;
  setIsTerminalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShellOutputLines: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  const {
    terminalDrawerH,
    setDevServer,
    onDevServerUrlRef,
    isTerminalOpen,
    setIsTerminalOpen,
    setShellOutputLines,
  } = opts;

  const terminalRef = useRef<XTermShellHandle>(null);

  const runInTerminal = useCallback(
    (cmd: string) => {
      if (!isTerminalOpen) setIsTerminalOpen(true);
      setTimeout(() => terminalRef.current?.runCommand(cmd), 100);
    },
    [isTerminalOpen, setIsTerminalOpen],
  );

  const writeToTerminal = useCallback(
    (text: string) => {
      if (!isTerminalOpen) setIsTerminalOpen(true);
      setTimeout(() => terminalRef.current?.writeToTerminal(text), 100);
    },
    [isTerminalOpen, setIsTerminalOpen],
  );

  const handleCommandExecution = useCallback((cmdText: string) => {
    terminalRef.current?.runCommand(cmdText);
  }, []);

  const handleTerminalOutputLine = useCallback(
    (line: string) => {
      setShellOutputLines((prev) => [...prev.slice(-250), line]);
      const hit = parseDevServerFromTerminalLine(line);
      if (!hit) return;
      const next: DevServerState = { port: hit.port, url: hit.url, updatedAt: Date.now() };
      setDevServer(next);
      onDevServerUrlRef.current?.(hit.url);
    },
    [setDevServer, onDevServerUrlRef, setShellOutputLines],
  );

  useEffect(() => {
    const onRun = (e: Event) => {
      const d = (e as CustomEvent<{ cmd: string }>).detail;
      if (!d?.cmd) return;
      setIsTerminalOpen(true);
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
      requestAnimationFrame(() => {
        if (terminalRef.current) {
          terminalRef.current.runCommand(d.cmd);
        }
      });
    };

    const onToggle = (e: Event) => {
      const d = (e as CustomEvent<{ open?: boolean; tab?: ShellTab }>).detail;
      if (d && typeof d.open === 'boolean') {
        setIsTerminalOpen(d.open);
        if (d.open) {
          setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
          if (d.tab) {
            setTimeout(() => terminalRef.current?.setActiveTab(d.tab), 50);
          }
        }
      } else {
        setIsTerminalOpen((p) => {
          const next = !p;
          if (next) setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
          return next;
        });
      }
    };

    window.addEventListener('iam-run-command', onRun as EventListener);
    window.addEventListener('iam-terminal-toggle', onToggle as EventListener);
    return () => {
      window.removeEventListener('iam-run-command', onRun as EventListener);
      window.removeEventListener('iam-terminal-toggle', onToggle as EventListener);
    };
  }, [setIsTerminalOpen]);

  useEffect(() => {
    const handler = () => {
      setIsTerminalOpen(true);
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    };
    window.addEventListener('iam:open-terminal', handler);
    return () => window.removeEventListener('iam:open-terminal', handler);
  }, [setIsTerminalOpen]);

  useEffect(() => {
    const onStudioOutput = (e: Event) => {
      const d = (e as CustomEvent<{ line?: string; open?: boolean; tab?: ShellTab }>).detail;
      if (!d?.line) return;
      handleTerminalOutputLine(d.line);
      if (!d.open) return;
      setIsTerminalOpen(true);
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
      setTimeout(() => terminalRef.current?.setActiveTab(d.tab ?? 'output'), 50);
    };
    window.addEventListener('iam-terminal-output', onStudioOutput as EventListener);
    return () => window.removeEventListener('iam-terminal-output', onStudioOutput as EventListener);
  }, [handleTerminalOutputLine, setIsTerminalOpen]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--terminal-drawer-h',
      isTerminalOpen ? `${terminalDrawerH}px` : '0px',
    );
    document.documentElement.dataset.terminalOpen = isTerminalOpen ? '1' : '';
    // `--terminal-panel-h` is owned by XTermShell while mounted; clear only on close.
    if (!isTerminalOpen) {
      document.documentElement.style.setProperty('--terminal-panel-h', '0px');
    }
    window.dispatchEvent(new Event('iam-terminal-panel-h'));
    return () => {
      document.documentElement.style.setProperty('--terminal-drawer-h', '0px');
      document.documentElement.style.setProperty('--terminal-panel-h', '0px');
      document.documentElement.dataset.terminalOpen = '';
      window.dispatchEvent(new Event('iam-terminal-panel-h'));
    };
  }, [isTerminalOpen, terminalDrawerH]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        setIsTerminalOpen((p) => {
          const next = !p;
          if (next) setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
          return next;
        });
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setIsTerminalOpen]);

  return {
    terminalRef,
    runInTerminal,
    writeToTerminal,
    handleCommandExecution,
    handleTerminalOutputLine,
  };
}
