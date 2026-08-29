/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import type { AgentMode } from '../types';
import type { AgentToolTraceRow } from './types';
import { ToolTraceRow } from './ToolTraceRow';
import { OfflineRunnerEmbed } from '../../agent/OfflineRunnerEmbed';
import { isImageGenerationToolName, isVideoGenerationToolName } from '../../../lib/toolTracePreview';
import { formatExecutionTimelineSummary } from '../../../lib/formatToolTraceDisplayTitle';
import { AgentModePresenceIcon } from '../../../features/mode-presence/AgentModePresenceIcon';
import type { AgentPresenceState } from '../../../features/mode-presence/agentModePresenceMap';
import { resolveToolTracePresence } from '../../../features/agent-run/toolTracePresence';
import './toolTraceTimeline.css';

function isMediaGenTool(toolName?: string | null): boolean {
  return isImageGenerationToolName(toolName) || isVideoGenerationToolName(toolName);
}

export type ExecutionTimelineProps = {
  rows: AgentToolTraceRow[];
  mode?: AgentMode;
  workspaceId?: string | null;
  compact?: boolean;
  onDismissRow?: (id: string) => void;
  onClear?: () => void;
  onCadJobTerminal?: (rowId: string) => void;
  showDoneFooter?: boolean;
  /** Resolved model for this turn (e.g. gpt-5.6-terra) — shown in Done footer. */
  runModelKey?: string | null;
  onOpenInEditor?: (file: { name: string; content: string }) => void;
};

export const ExecutionTimeline: React.FC<ExecutionTimelineProps> = ({
  rows,
  mode = 'agent',
  workspaceId = null,
  compact = false,
  onDismissRow,
  onClear,
  onCadJobTerminal,
  showDoneFooter = false,
  runModelKey = null,
  onOpenInEditor,
}) => {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const visibleRows = useMemo(
    () => rows.filter((r) => !isMediaGenTool(r.toolName)),
    [rows],
  );
  const summary = useMemo(
    () => formatExecutionTimelineSummary(visibleRows),
    [visibleRows],
  );

  if (!rows.length || !visibleRows.length) return null;

  const anyRunning = visibleRows.some((r) => r.status === 'running' && !r.cadJobLive);
  const anyFailed = visibleRows.some((r) => r.status === 'error');
  const anyCadLive = visibleRows.some((r) => r.cadJobLive);
  // Keep CAD / terminal live panels reachable without forcing the JSON stack open.
  const forceDetails =
    anyCadLive ||
    visibleRows.some(
      (r) => r.status === 'running' && r.toolName?.startsWith('agentsam_terminal'),
    );

  const lead = visibleRows[visibleRows.length - 1];
  const leadPresence = resolveToolTracePresence({
    toolName: lead.toolName,
    status: lead.status,
    mode,
    lines: lead.lines,
  });
  const cardState: AgentPresenceState = anyFailed
    ? 'failed'
    : anyRunning || anyCadLive
      ? (leadPresence.presenceState as AgentPresenceState)
      : 'complete';

  const showDetails = detailsOpen || forceDetails;
  // Dodge mini-game only after a tool failure — never as a wait spinner.
  const showRunner = anyFailed;

  return (
    <div className="mt-2 min-w-0" aria-label="Execution timeline">
      <div className="tool-trace-fold">
        <button
          type="button"
          className="tool-trace-fold-btn"
          onClick={() => setDetailsOpen((v) => !v)}
          aria-expanded={showDetails}
        >
          <AgentModePresenceIcon
            mode={mode}
            state={cardState}
            iconKey={leadPresence.iconKey}
            size={22}
            className="tool-trace-fold-icon shrink-0"
            aria-label={summary}
          />
          <span
            className={`tool-trace-title truncate${anyRunning || anyCadLive ? ' tool-trace-title--shimmer' : ''}${
              anyFailed ? ' tool-trace-title--error' : ''
            }`}
          >
            {summary}
          </span>
          <span
            className={`tool-trace-chevron${showDetails ? ' tool-trace-chevron--open' : ''}`}
            aria-hidden
          />
        </button>
        {onClear && !anyRunning ? (
          <button type="button" className="tool-trace-fold-clear" onClick={onClear}>
            Clear
          </button>
        ) : null}
      </div>

      {showDetails ? (
        <div className="tool-trace-stack tool-trace-stack--nested">
          {visibleRows.map((row) => (
            <ToolTraceRow
              key={row.id}
              row={row}
              mode={mode}
              workspaceId={workspaceId}
              compact={compact}
              defaultExpanded={Boolean(row.cadJobLive)}
              onOpenInEditor={onOpenInEditor}
              onDismiss={onDismissRow ? () => onDismissRow(row.id) : undefined}
              onCadJobTerminal={onCadJobTerminal}
            />
          ))}
        </div>
      ) : null}

      {showRunner ? (
        <div className="tool-trace-wait-runner mt-2 mb-1">
          <OfflineRunnerEmbed height={200} tone="failure" />
        </div>
      ) : null}

      {showDoneFooter && !anyRunning ? (
        <div className="tool-trace-done" role="status">
          <span className="tool-trace-done-mark" aria-hidden>
            ✓
          </span>
          <span>Done</span>
          {runModelKey?.trim() ? (
            <span className="tool-trace-done-meta" title={runModelKey.trim()}>
              · {runModelKey.trim()}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
