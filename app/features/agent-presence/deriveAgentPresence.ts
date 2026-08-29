/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentToolTraceRow } from '../agent-chat/execution/types';
import type { WorkflowLedgerState, AgentMode } from '../agent-chat/types';
import type { ThinkingCardState } from '../../src/components/ThinkingCard';
import type { AgentPresence, AgentPresenceState, AgentLogoMotion } from './presenceTypes';
import { pickPresenceLine } from './presenceCopy';
import { formatThinkingStepName } from '../agent-chat/formatThinkingStepName';
import { formatToolTraceDisplayTitle, resolveToolTraceCommand } from '../../lib/formatToolTraceDisplayTitle';

export type DerivePresenceInput = {
  isLoading: boolean;
  mode: AgentMode;
  thinkingState: ThinkingCardState | null;
  pendingToolApproval: { tool: { name?: string; preview?: string; plan_terminal?: unknown } } | null;
  approvalBusy: boolean;
  /** Multitask/subagent structured activity from SSE (fanout, merge, action required). */
  subagentWork?: { state: AgentPresenceState; detail?: string } | null;
  toolTraceRows: AgentToolTraceRow[];
  workflowLedger: WorkflowLedgerState;
  draftSyntaxBusy: boolean;
  draftRunBusy: boolean;
  /** Brief post-stream UI flash */
  presenceFlash: 'complete' | 'failed' | null;
  /** D1-backed plan tasks currently running (plan mode). */
  activePlanRunningCount?: number;
};

function motionFor(state: AgentPresenceState): AgentLogoMotion {
  switch (state) {
    case 'terminal':
      return 'running';
    case 'browser_debug':
    case 'web_search':
    case 'web_fetch':
      return state as AgentLogoMotion;
    case 'waiting_approval':
    case 'browser_human_input':
      return 'blocked';
    default:
      return state as AgentLogoMotion;
  }
}

function classifyRunningTool(row: AgentToolTraceRow): AgentPresenceState {
  const tn = (row.toolName || '').toLowerCase();
  const line0 = (row.lines[0] || '').toLowerCase();
  const hay = `${tn} ${line0}`;

  if (hay.includes('py_compile') || hay.includes('python3') || hay.includes('terminal'))
    return 'terminal';

  if (hay.includes('d1') || hay.includes('sql') || hay.includes('supabase') || hay.includes('query'))
    return 'database';

  if (
    hay.includes('tavily') ||
    hay.includes('search_web') ||
    hay.includes('open_web_search') ||
    hay.includes('web_search')
  )
    return 'web_search';

  if (
    hay.includes('web_fetch') ||
    hay.includes('fetch_url') ||
    hay.includes('markdown') ||
    hay.includes('read_url')
  )
    return 'web_fetch';

  if (
    hay.includes('human_input') ||
    hay.includes('human-in-the-loop') ||
    hay.includes('hitl') ||
    hay.includes('browser_human_input_required')
  )
    return 'browser_human_input';

  if (
    hay.includes('screenshot') ||
    hay.includes('capture_full_page') ||
    hay.includes('capture_selected') ||
    hay.includes('quality_report')
  )
    return 'browser_capture';

  if (
    hay.includes('browser_verify') ||
    hay.includes('verify_current_page') ||
    hay.includes('browser_content') ||
    hay.includes('cdt_take_snapshot') ||
    hay.includes('console') ||
    hay.includes('network')
  )
    return 'browser_debug';

  if (
    hay.includes('browser_scroll') ||
    hay.includes('live_view') ||
    hay.includes('browser_session') ||
    hay.includes('devtoolsfrontendurl') ||
    hay.includes('browser_live') ||
    hay.includes('cdt_navigate') ||
    hay.includes('cdt_click') ||
    hay.includes('cdt_fill') ||
    hay.includes('cdt_wait') ||
    hay.includes('cdt_evaluate') ||
    hay.includes('playwright') ||
    hay.includes('browser_navigate') ||
    hay.includes('browser_click') ||
    hay.includes('browser_fill')
  )
    return 'browser_live';

  if (hay.includes('browser'))
    return 'browser';

  if (hay.includes('monaco') || hay.includes('file') || line0.includes('.py'))
    return 'writing';

  return 'tool';
}

export function deriveAgentPresence(i: DerivePresenceInput): { presence: AgentPresence; logoMotion: AgentLogoMotion } {
  const seed =
    i.toolTraceRows.map((r) => r.id + r.status).join('|') +
    (i.pendingToolApproval?.tool.name || '') +
    (i.workflowLedger.runId || '');

  if (i.presenceFlash === 'failed') {
    const p: AgentPresence = {
      state: 'failed',
      label: pickPresenceLine('failed', seed),
      detail: i.toolTraceRows.length ? i.toolTraceRows[i.toolTraceRows.length - 1]?.lines.join('\n').slice(0, 200) : undefined,
    };
    return { presence: p, logoMotion: 'failed' };
  }
  if (i.presenceFlash === 'complete') {
    const p: AgentPresence = {
      state: 'complete',
      label: pickPresenceLine('complete', seed),
    };
    return { presence: p, logoMotion: 'complete' };
  }

  if (i.pendingToolApproval) {
    const prev = String(i.pendingToolApproval.tool.preview || '').split('\n')[0]?.slice(0, 140);
    const p: AgentPresence = {
      state: 'approval_required',
      label: pickPresenceLine('waiting_approval', seed),
      detail: prev || i.pendingToolApproval.tool.name,
    };
    return { presence: p, logoMotion: motionFor('waiting_approval') };
  }

  if (i.approvalBusy) {
    const p: AgentPresence = {
      state: 'waiting_approval',
      label: 'Applying your approval…',
      detail: i.pendingToolApproval?.tool?.name || undefined,
      toolName: 'approval',
    };
    return { presence: p, logoMotion: 'tool' };
  }

  if (i.draftSyntaxBusy) {
    const p: AgentPresence = {
      state: 'terminal',
      label: 'Syntax-checking the draft.',
      detail: 'python3 -m py_compile (single-line, workspace path)',
    };
    return { presence: p, logoMotion: 'running' };
  }
  if (i.draftRunBusy) {
    const p: AgentPresence = {
      state: 'terminal',
      label: 'Running the script in terminal.',
      detail: 'python3 <workspace path>',
    };
    return { presence: p, logoMotion: 'running' };
  }

  if (i.isLoading && i.subagentWork?.state) {
    const p: AgentPresence = {
      state: i.subagentWork.state,
      label: pickPresenceLine('tool', seed + '|subagents'),
      detail: i.subagentWork.detail,
      toolName: 'subagents',
    };
    // Multitask is visual-first; motion can stay 'tool' so idle avatars don't appear.
    return { presence: p, logoMotion: 'tool' };
  }

  const runningRow = [...i.toolTraceRows].reverse().find((r) => r.status === 'running');

  if (i.isLoading && i.thinkingState?.surface === 'terminal' && !runningRow) {
    const p: AgentPresence = {
      state: 'terminal',
      label: i.thinkingState.thinkingText?.trim() || 'Running command…',
      toolName: 'agentsam_terminal',
    };
    return { presence: p, logoMotion: motionFor('terminal') };
  }

  if (i.isLoading && runningRow) {
    const st = classifyRunningTool(runningRow);
    const label = formatToolTraceDisplayTitle(runningRow);
    const detail =
      resolveToolTraceCommand(runningRow) ||
      runningRow.lines.join('\n').trim().slice(0, 180) ||
      runningRow.toolName;
    const p: AgentPresence = {
      state: st,
      label,
      detail,
      toolName: runningRow.toolName,
    };
    return { presence: p, logoMotion: motionFor(st) };
  }

  if (i.isLoading && i.workflowLedger.runId && !i.workflowLedger.lastError) {
    const p: AgentPresence = {
      state: 'task_queue',
      label: 'Workflow in progress…',
      detail: i.workflowLedger.currentNodeKey || i.workflowLedger.runId.slice(0, 14),
    };
    return { presence: p, logoMotion: motionFor('reading') };
  }

  if (i.isLoading && i.thinkingState) {
    const runStep = i.thinkingState.steps.find((s) => s.status === 'running');
    if (runStep) {
      const pseudoRow: AgentToolTraceRow = {
        id: runStep.id,
        toolName: runStep.name,
        status: 'running',
        lines: runStep.preview ? [runStep.preview] : [],
        startedAtLabel: '',
      };
      const st = classifyRunningTool(pseudoRow);
      const p: AgentPresence = {
        state: st,
        label: formatThinkingStepName({
          tool_name: runStep.name,
          title: runStep.name,
          node_key: runStep.id,
        }),
        detail: runStep.preview,
        toolName: runStep.name,
      };
      return { presence: p, logoMotion: motionFor(st) };
    }
    if (i.thinkingState.status === 'blocked') {
      const hitlStep = i.thinkingState.steps.find((s) => s.status === 'blocked');
      const p: AgentPresence = {
        state: 'browser_human_input',
        label: hitlStep?.name || pickPresenceLine('browser_human_input', seed),
        detail: hitlStep?.preview,
      };
      return { presence: p, logoMotion: 'blocked' };
    }
    if (i.thinkingState.status === 'thinking' || i.thinkingState.status === 'working') {
      if (i.mode === 'plan') {
        const txt = (i.thinkingState.thinkingText || '').toLowerCase();
        const runningTasks = i.activePlanRunningCount ?? 0;
        const planState =
          txt.includes('handoff') || txt.includes('plan ready') || txt.includes('switch to')
            ? 'handoff_ready'
            : runningTasks > 0 ||
                txt.includes('running plan') ||
                txt.includes('task') ||
                i.thinkingState.status === 'working'
              ? 'task_stack'
              : 'mapping';
        const p: AgentPresence = {
          state: planState as AgentPresence['state'],
          label: pickPresenceLine('planning', seed),
          detail: i.thinkingState.thinkingText?.trim().slice(0, 120) || undefined,
        };
        return { presence: p, logoMotion: motionFor('planning') };
      }
      if (i.mode === 'debug') {
        const txt = (i.thinkingState.thinkingText || '').toLowerCase();
        const debugState =
          txt.includes('isolate') || txt.includes('fault')
            ? 'fault_isolate'
            : txt.includes('regression')
              ? 'regression_check'
              : txt.includes('hypothesis')
                ? 'hypothesis'
                : 'trace_probe';
        const p: AgentPresence = {
          state: debugState as AgentPresence['state'],
          label: pickPresenceLine('thinking', seed + '|debug'),
          detail: i.thinkingState.thinkingText?.trim().slice(0, 120) || undefined,
        };
        return { presence: p, logoMotion: motionFor('thinking') };
      }
      if (i.mode === 'multitask') {
        const p: AgentPresence = {
          state: 'multitask_fanout',
          label: 'Coordinating subagents…',
        };
        return { presence: p, logoMotion: 'tool' };
      }
      if (i.mode === 'ask') {
        const p: AgentPresence = {
          state: 'reading',
          label: pickPresenceLine('reading', seed),
          detail: i.thinkingState.thinkingText?.trim().slice(0, 120) || undefined,
        };
        return { presence: p, logoMotion: motionFor('reading') };
      }
      const p: AgentPresence = {
        state: 'thinking',
        label:
          i.thinkingState.thinkingText?.trim().slice(0, 120) ||
          pickPresenceLine('thinking', seed),
        detail: i.thinkingState.thinkingText?.trim().slice(0, 120) || undefined,
      };
      return { presence: p, logoMotion: motionFor('thinking') };
    }
  }

  if (i.isLoading && i.mode === 'plan') {
    const txt = (i.thinkingState?.thinkingText || '').toLowerCase();
    const runningTasks = i.activePlanRunningCount ?? 0;
    const planState =
      txt.includes('handoff') || txt.includes('plan ready') || txt.includes('switch to')
        ? 'handoff_ready'
        : runningTasks > 0 ||
            txt.includes('running plan') ||
            txt.includes('task') ||
            i.thinkingState?.status === 'working'
          ? 'task_stack'
          : 'mapping';
    const p: AgentPresence = {
      state: planState as AgentPresence['state'],
      label: pickPresenceLine('planning', seed),
      detail: i.thinkingState?.thinkingText?.trim().slice(0, 120) || undefined,
    };
    return { presence: p, logoMotion: motionFor('planning') };
  }

  if (i.isLoading && i.mode === 'debug') {
    const p: AgentPresence = {
      state: 'trace_probe' as AgentPresence['state'],
      label: pickPresenceLine('thinking', seed + '|debug'),
    };
    return { presence: p, logoMotion: motionFor('thinking') };
  }

  if (i.isLoading && i.mode === 'multitask') {
    const p: AgentPresence = {
      state: 'multitask_fanout',
      label: 'Coordinating subagents…',
    };
    return { presence: p, logoMotion: 'tool' };
  }

  if (i.isLoading) {
    const p: AgentPresence = {
      state: 'thinking',
      label: pickPresenceLine('thinking', seed + '|stream'),
    };
    return { presence: p, logoMotion: motionFor('thinking') };
  }

  const p: AgentPresence = {
    state: 'idle',
    label: pickPresenceLine('idle', seed + '|idle'),
  };
  return { presence: p, logoMotion: 'idle' };
}
