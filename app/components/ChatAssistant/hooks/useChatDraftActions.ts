/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Local Python draft syntax/run via terminal.
 */

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { ActiveFile } from '../../../types';
import type { AgentToolTraceRow } from '../execution/types';
import { shellSingleQuote } from '../execution';

export function useChatDraftActions(args: {
  activeFile: ActiveFile | null | undefined;
  activeFileName: string | null | undefined;
  setToolTraceRows: Dispatch<SetStateAction<AgentToolTraceRow[]>>;
  setPythonDraftHint: Dispatch<SetStateAction<string | null>>;
}) {
  const { activeFile, activeFileName, setToolTraceRows, setPythonDraftHint } = args;
  const [draftSyntaxBusy, setDraftSyntaxBusy] = useState(false);
  const [draftRunBusy, setDraftRunBusy] = useState(false);

  const runDraftTerminalCommand = useCallback(async (label: string, cmd: string) => {
    const id = `local-script-${Date.now()}`;
    setToolTraceRows((prev) => [
      ...prev,
      {
        id,
        toolName: label,
        status: 'running',
        lines: [`$ ${cmd}`],
        startedAtLabel: new Date().toLocaleTimeString(),
        local: true,
      },
    ]);
    try {
      const res = await fetch('/api/agent/terminal/run', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      const j = (await res.json().catch(() => ({}))) as { output?: string; error?: string };
      const out = (j.output ?? j.error ?? '').slice(0, 12000);
      const ok = res.ok && !j.error;
      setToolTraceRows((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                status: ok ? 'done' : 'error',
                lines: [`$ ${cmd}`, out || (res.ok ? '(no stdout/stderr captured)' : `HTTP ${res.status}`)],
              }
            : r,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setToolTraceRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: 'error', lines: [...r.lines, msg] } : r)),
      );
    }
  }, []);

  const handlePythonDraftOpened = useCallback((fileName: string) => {
    setPythonDraftHint(fileName);
  }, []);

  const handleDraftSyntaxCheck = useCallback(async () => {
    const wp = activeFile?.workspacePath?.trim();
    const name = activeFile?.name || activeFileName || '';
    if (!wp || wp.startsWith('mcp_tool:') || !/\.py$/i.test(name)) return;
    setDraftSyntaxBusy(true);
    try {
      const cmd = `python3 -m py_compile ${shellSingleQuote(wp)}`;
      await runDraftTerminalCommand('Syntax check (py_compile)', cmd);
    } finally {
      setDraftSyntaxBusy(false);
    }
  }, [activeFile, activeFileName, runDraftTerminalCommand]);

  const handleDraftRunScript = useCallback(async () => {
    const wp = activeFile?.workspacePath?.trim();
    const name = activeFile?.name || activeFileName || '';
    if (!wp || wp.startsWith('mcp_tool:') || !/\.py$/i.test(name)) return;
    setDraftRunBusy(true);
    try {
      const cmd = `python3 ${shellSingleQuote(wp)}`;
      await runDraftTerminalCommand('Run Python script', cmd);
    } finally {
      setDraftRunBusy(false);
    }
  }, [activeFile, activeFileName, runDraftTerminalCommand]);

  return {
    draftSyntaxBusy, draftRunBusy, handlePythonDraftOpened,
    handleDraftSyntaxCheck, handleDraftRunScript,
  };
}
