import type { AgentMode, ModePresenceIconKey } from './agentModePresenceMap';
import type { AgentToolTraceRow } from '../../components/ChatAssistant/execution/types';
import type { ThinkingCardState } from '../../src/components/ThinkingCard';
import type { AgentPresence } from '../agent-presence/presenceTypes';
import { formatThinkingStepName } from '../agent-chat/formatThinkingStepName';
import {
  formatToolTraceDisplayTitle,
  resolveToolTraceCommand,
} from '../../lib/formatToolTraceDisplayTitle';
import { resolveToolTracePresence } from '../agent-run/toolTracePresence';

export type InlinePresenceDisplay = {
  title: string;
  meta?: string;
  state: string;
  iconKey?: ModePresenceIconKey;
  cardStatus: 'thinking' | 'working' | 'blocked' | 'done' | 'error';
  shimmer: boolean;
};

function cardStatusFrom(
  presence: Pick<AgentPresence, 'state'>,
  thinkingState?: ThinkingCardState | null,
): InlinePresenceDisplay['cardStatus'] {
  if (thinkingState?.status === 'blocked') return 'blocked';
  if (thinkingState?.status === 'error') return 'error';
  if (thinkingState?.status === 'done') return 'done';
  if (presence.state === 'waiting_approval' || presence.state === 'approval_required')
    return 'blocked';
  if (presence.state === 'failed') return 'error';
  if (presence.state === 'complete') return 'done';
  if (thinkingState?.status === 'thinking') return 'thinking';
  return 'working';
}

/** Tool trace rows own the thread while a tool is executing — skip duplicate inline row. */
export function shouldShowInlinePresence(input: {
  showInlinePresence: boolean;
  toolTraceRows: AgentToolTraceRow[];
}): boolean {
  if (!input.showInlinePresence) return false;
  if (input.toolTraceRows.some((r) => r.status === 'running')) return false;
  return true;
}

function toolRowFromPresence(
  presence: Pick<AgentPresence, 'toolName' | 'detail'>,
): AgentToolTraceRow | null {
  const toolName = String(presence.toolName || '').trim();
  if (!toolName) return null;
  const detail = String(presence.detail || '').trim();
  return {
    id: 'inline-presence',
    toolName,
    status: 'running',
    lines: detail ? [detail] : [],
    startedAtLabel: '',
    integrationLabel: 'Agent Sam',
    detailsJson: detail.startsWith('{') ? detail : undefined,
  };
}

/**
 * Build inline presence copy from live SSE context — not presenceCopy pools.
 * Priority: thinking step → active tool name → streaming thinking text → deriveAgentPresence detail.
 */
export function resolveInlinePresenceDisplay(input: {
  mode: AgentMode;
  presence: Pick<AgentPresence, 'state' | 'label' | 'detail' | 'toolName'>;
  thinkingState?: ThinkingCardState | null;
}): InlinePresenceDisplay {
  const runningStep = input.thinkingState?.steps.find((s) => s.status === 'running');
  const toolRow = toolRowFromPresence(input.presence);

  let title: string;
  let meta: string | undefined;

  if (runningStep) {
    title = formatThinkingStepName({
      tool_name: runningStep.name,
      title: runningStep.name,
      node_key: runningStep.id,
    });
    meta = runningStep.preview?.trim() || undefined;
  } else if (toolRow) {
    title = formatToolTraceDisplayTitle(toolRow);
    meta =
      resolveToolTraceCommand(toolRow) ||
      toolRow.lines.join(' ').trim().slice(0, 120) ||
      undefined;
  } else {
    const thinkingText = input.thinkingState?.thinkingText?.trim();
    if (thinkingText && thinkingText.length >= 4 && thinkingText.length <= 140) {
      title = thinkingText;
    } else {
      title = input.presence.label;
      const detail = input.presence.detail?.trim();
      if (detail && detail.length >= 4) meta = detail.slice(0, 120);
    }
  }

  const cardStatus = cardStatusFrom(input.presence, input.thinkingState);
  const tracePresence = toolRow
    ? resolveToolTracePresence({
        toolName: toolRow.toolName,
        status: 'running',
        mode: input.mode,
        lines: toolRow.lines,
      })
    : null;

  const state = tracePresence?.presenceState || input.presence.state;
  const iconKey =
    tracePresence?.iconKey ||
    (input.thinkingState?.surface === 'terminal' || state === 'terminal' || state === 'executing'
      ? 'execute-pulse'
      : undefined);
  const shimmer = cardStatus === 'thinking' || cardStatus === 'working';

  return { title, meta, state, iconKey, cardStatus, shimmer };
}
