/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type { AgentMode } from '../types';
import type { AgentToolTraceRow } from './types';
import { resolveToolTracePresence } from '../../../features/agent-run/toolTracePresence';
import { AgentModePresenceIcon } from '../../../features/mode-presence/AgentModePresenceIcon';
import type { AgentPresenceState } from '../../../features/mode-presence/agentModePresenceMap';
import {
  formatToolTraceActivitySentence,
  resolveToolTraceMetaLabel,
} from '../../../lib/formatToolTraceDisplayTitle';
import {
  extractToolTraceDebugMeta,
  monacoHandoffFilename,
  resolveToolTraceBlocks,
  resolveSqlResultTable,
} from '../../../lib/toolTracePreview';
import { isCadToolName } from '../../../lib/cadToolTrace';
import { ToolTraceCodeBlock } from './ToolTraceCodeBlock';
import { ToolTraceSqlTable } from './ToolTraceSqlTable';
import { ToolTraceCadLivePanel } from './ToolTraceCadLivePanel';
import { AgentTerminalLivePanel } from './AgentTerminalLivePanel';
import './toolTraceTimeline.css';

function isTerminalTool(toolName?: string | null) {
  return Boolean(toolName && toolName.startsWith('agentsam_terminal'));
}

export type ToolTraceRowProps = {
  row: AgentToolTraceRow;
  mode?: AgentMode;
  workspaceId?: string | null;
  defaultExpanded?: boolean;
  compact?: boolean;
  onDismiss?: () => void;
  onOpenInEditor?: (file: { name: string; content: string }) => void;
  onCadJobTerminal?: (rowId: string) => void;
};

export const ToolTraceRow: React.FC<ToolTraceRowProps> = ({
  row,
  mode = 'agent',
  workspaceId = null,
  defaultExpanded = false,
  compact = false,
  onDismiss,
  onOpenInEditor,
  onCadJobTerminal,
}) => {
  const failed = row.status === 'error';
  const running = row.status === 'running';
  const cadLive = Boolean(row.cadJobLive && row.cadJobId);
  const terminalTool = isTerminalTool(row.toolName);
  // Never auto-dump request JSON while running — fold stays one sentence until click.
  const hideRequestPreview = running || (compact && terminalTool);
  const [open, setOpen] = useState(defaultExpanded || cadLive);
  const [debugOpen, setDebugOpen] = useState(false);

  const tracePresence = useMemo(
    () =>
      resolveToolTracePresence({
        toolName: row.toolName,
        status: row.status,
        mode,
        lines: row.lines,
      }),
    [row.toolName, row.status, row.lines, mode],
  );

  const title = formatToolTraceActivitySentence(row);
  const { command, request, result } = useMemo(() => resolveToolTraceBlocks(row), [row]);
  const sqlTable = useMemo(() => resolveSqlResultTable(row), [row]);
  const metaLabel = resolveToolTraceMetaLabel(row, command);
  const debugMeta = useMemo(() => extractToolTraceDebugMeta(row), [row]);

  const durationLabel =
    row.durationMs != null && !running
      ? row.durationMs < 1000
        ? `${row.durationMs}ms`
        : `${(row.durationMs / 1000).toFixed(1)}s`
      : '';

  const hasExpandable =
    cadLive || terminalTool || Boolean(request || sqlTable || result || failed);

  useEffect(() => {
    if (cadLive) setOpen(true);
  }, [cadLive]);

  const toggle = useCallback(() => {
    if (hasExpandable) setOpen((v) => !v);
  }, [hasExpandable]);

  return (
    <div className="tool-trace-item min-w-0" data-status={row.status} data-lane={tracePresence.lane}>
      <div className="tool-trace-row-btn flex items-start">
        <button
          type="button"
          className="tool-trace-collapsed-btn flex items-center gap-2 min-w-0 flex-1"
          onClick={toggle}
          aria-expanded={open}
          disabled={!hasExpandable}
        >
          <AgentModePresenceIcon
            mode={mode}
            state={tracePresence.presenceState as AgentPresenceState}
            iconKey={tracePresence.iconKey}
            size={20}
            className="tool-trace-collapsed-icon shrink-0"
            aria-label={title}
          />
          <span
            className={`tool-trace-title truncate${running || cadLive ? ' tool-trace-title--shimmer' : ''}${
              failed ? ' tool-trace-title--error' : ''
            }`}
          >
            {title}
          </span>
          {!running && durationLabel ? (
            <span className="tool-trace-duration shrink-0">{durationLabel}</span>
          ) : null}
          {hasExpandable ? (
            <span className={`tool-trace-chevron${open ? ' tool-trace-chevron--open' : ''}`} aria-hidden />
          ) : null}
        </button>
        {onDismiss && !running && !cadLive ? (
          <button
            type="button"
            className="shrink-0 ml-1 text-[10px] text-[var(--dashboard-muted)] hover:text-[var(--solar-cyan)] self-start mt-1"
            onClick={onDismiss}
          >
            ×
          </button>
        ) : null}
      </div>

      {open && hasExpandable ? (
        <div className="tool-trace-expand">
          {metaLabel ? <div className="tool-trace-meta tool-trace-meta--expand">{metaLabel}</div> : null}

          {cadLive && row.cadJobId ? (
            <ToolTraceCadLivePanel
              jobId={row.cadJobId}
              engineHint={isCadToolName(row.toolName) && /meshy/i.test(row.toolName) ? 'meshy' : undefined}
              onTerminal={() => onCadJobTerminal?.(row.id)}
            />
          ) : null}

          {terminalTool && workspaceId ? (
            <div className="mb-2">
              <AgentTerminalLivePanel workspaceId={workspaceId} compact />
            </div>
          ) : null}

          {request && !hideRequestPreview ? (
            <ToolTraceCodeBlock
              label="Request"
              text={request.text}
              lang={request.lang}
              onOpenInEditor={onOpenInEditor}
              editorFilename={monacoHandoffFilename(row, 'request', request.lang)}
            />
          ) : null}

          {sqlTable ? (
            <div className="tool-trace-code-block">
              <span className="tool-trace-code-block__label">Result</span>
              <div className="tool-trace-code-viewport px-1 pb-1">
                <ToolTraceSqlTable rows={sqlTable.rows} />
              </div>
            </div>
          ) : result ? (
            <ToolTraceCodeBlock
              label={running ? 'Output' : 'Result'}
              text={result.text}
              lang={result.lang}
              onOpenInEditor={onOpenInEditor}
              editorFilename={monacoHandoffFilename(row, 'result', result.lang)}
            />
          ) : null}

          {failed && !request && !result ? (
            <p className="text-[11px] text-red-400 m-0 px-1">Tool failed</p>
          ) : null}

          {debugMeta ? (
            <div className="tool-trace-debug mt-2">
              <button
                type="button"
                className="tool-trace-debug-toggle"
                onClick={() => setDebugOpen((v) => !v)}
                aria-expanded={debugOpen}
              >
                Debug metadata
                <span className={`tool-trace-chevron ml-1${debugOpen ? ' tool-trace-chevron--open' : ''}`} aria-hidden />
              </button>
              {debugOpen ? (
                <pre className="tool-trace-debug-pre m-0 mt-1">
                  {JSON.stringify(debugMeta, null, 2)}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
