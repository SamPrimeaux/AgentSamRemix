/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Mechanical peel from ChatAssistant.tsx — behavior-identical move.
 */

import { useCallback, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import { derivePresenceState } from '../../../features/agent-presence/iamDerivePresenceState';
import {
  formatThinkingStepName,
  formatBrowserLiveSseStepName,
  upsertThinkingStep,
} from '../../../features/agent-chat/formatThinkingStepName';
import type { ThinkingCardState } from '../../../src/components/ThinkingCard';

export type ChatThinkingEvent = {
  type: string;
  tool_name?: string;
  text?: string;
  ok?: boolean;
  output_preview?: string;
  command_run_id?: string;
  approval_id?: string;
  plan_id?: string;
  url?: string;
  title?: string;
  reason?: string;
  live_view_url?: string;
  node_key?: string;
  execution_lane?: string;
  lane?: string;
  label?: string;
  plan_title?: string;
  direction?: string;
};

export type UseChatThinkingEventsArgs = {
  setPresenceState: Dispatch<SetStateAction<string>>;
  setThinkingState: Dispatch<SetStateAction<ThinkingCardState | null>>;
  activePlanIdRef: MutableRefObject<string | null>;
  setLocalActivePlanId: Dispatch<SetStateAction<string | null>>;
  setActivePlanTitle: Dispatch<SetStateAction<string | null>>;
  onActivePlanChange?: (planId: string | null) => void;
  onApprovalRequired?: (commandRunId: string) => void;
};

export function useChatThinkingEvents({
  setPresenceState,
  setThinkingState,
  activePlanIdRef,
  setLocalActivePlanId,
  setActivePlanTitle,
  onActivePlanChange,
  onApprovalRequired,
}: UseChatThinkingEventsArgs) {
const handleThinkingEvent = useCallback((ev: {
  type: string;
  tool_name?: string;
  text?: string;
  ok?: boolean;
  output_preview?: string;
  command_run_id?: string;
  approval_id?: string;
  plan_id?: string;
  url?: string;
  title?: string;
  reason?: string;
  live_view_url?: string;
  node_key?: string;
  execution_lane?: string;
  lane?: string;
  label?: string;
}) => {
  setPresenceState(derivePresenceState(ev));
  if (ev.type === 'thinking_start') {
    setThinkingState({ steps: [], thinkingText: '', status: 'thinking', startedAt: Date.now() });
  } else if (ev.type === 'thinking') {
    setThinkingState(prev => prev ? { ...prev, thinkingText: (prev.thinkingText || '') + (ev.text || '') } : prev);
  } else if (ev.type === 'plan_thinking') {
    setThinkingState({
      steps: [],
      thinkingText: ev.text || 'Creating plan…',
      status: 'thinking',
      startedAt: Date.now(),
      surface: 'plan',
    });
  } else if (ev.type === 'plan_created' || ev.type === 'plan_progress') {
    if (ev.plan_id?.trim()) {
      activePlanIdRef.current = ev.plan_id.trim();
      setLocalActivePlanId(ev.plan_id.trim());
      onActivePlanChange?.(ev.plan_id.trim());
    }
    if (typeof (ev as { plan_title?: string }).plan_title === 'string') {
      setActivePlanTitle(String((ev as { plan_title?: string }).plan_title).trim() || null);
    }
    setThinkingState(prev => ({
      steps: prev?.steps ?? [],
      thinkingText: ev.text || 'Running plan…',
      status: 'working',
      startedAt: prev?.startedAt ?? Date.now(),
    }));
  } else if (ev.type === 'tool_start') {
    const id = ev.tool_name || ev.node_key || String(Date.now());
    const name = formatThinkingStepName(ev);
    setThinkingState(prev => {
      const base = prev ?? { steps: [], thinkingText: name, status: 'working', startedAt: Date.now() };
      if (base.steps.find(s => s.id === id)) return { ...base, thinkingText: name, status: 'working' };
      return {
        ...base,
        status: 'working',
        thinkingText: name,
        steps: [...base.steps, { id, name, status: 'running' as const }],
      };
    });
  } else if (ev.type === 'browser_session_starting') {
    setThinkingState(prev => {
      const base = prev ?? { steps: [], thinkingText: '', status: 'working', startedAt: Date.now() };
      return {
        ...base,
        status: 'working',
        steps: upsertThinkingStep(base.steps, {
          id: 'browser_session',
          name: formatBrowserLiveSseStepName(ev.type),
          status: 'running',
        }),
      };
    });
  } else if (ev.type === 'browser_url_committed' || ev.type === 'browser_navigated') {
    setThinkingState(prev => {
      const base = prev ?? { steps: [], thinkingText: '', status: 'working', startedAt: Date.now() };
      const label =
        ev.type === 'browser_navigated' && ev.url
          ? `Navigated to ${ev.url}`
          : formatBrowserLiveSseStepName(ev.type);
      return {
        ...base,
        status: 'working',
        steps: upsertThinkingStep(base.steps, {
          id: `browser_nav_${String(ev.url || Date.now())}`,
          name: label,
          status: 'done',
        }),
      };
    });
  } else if (ev.type === 'browser_scrolled') {
    setThinkingState(prev => {
      const base = prev ?? { steps: [], thinkingText: '', status: 'working', startedAt: Date.now() };
      const dir = String((ev as { direction?: string }).direction || 'down');
      return {
        ...base,
        status: 'working',
        steps: upsertThinkingStep(base.steps, {
          id: `browser_scroll_${dir}_${Date.now()}`,
          name: dir === 'up' ? 'Scrolled up' : 'Scrolled down',
          status: 'done',
        }),
      };
    });
  } else if (ev.type === 'browser_session_ready' || ev.type === 'browser_live_view_ready') {
    setThinkingState(prev => {
      const base = prev ?? { steps: [], thinkingText: '', status: 'working', startedAt: Date.now() };
      return {
        ...base,
        status: 'working',
        steps: upsertThinkingStep(base.steps, {
          id: 'browser_live_view',
          name: formatBrowserLiveSseStepName(ev.type),
          status: 'done',
          preview: ev.url || ev.title || ev.live_view_url || undefined,
        }),
      };
    });
  } else if (ev.type === 'browser_action_started') {
    const id = ev.tool_name ? `browser_action_${ev.tool_name}` : 'browser_action';
    setThinkingState(prev => {
      const base = prev ?? { steps: [], thinkingText: '', status: 'working', startedAt: Date.now() };
      return {
        ...base,
        status: 'working',
        steps: upsertThinkingStep(base.steps, {
          id,
          name: formatThinkingStepName(ev) || formatBrowserLiveSseStepName(ev.type),
          status: 'running',
        }),
      };
    });
  } else if (ev.type === 'browser_action_done') {
    const id = ev.tool_name ? `browser_action_${ev.tool_name}` : 'browser_action';
    setThinkingState(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        steps: upsertThinkingStep(prev.steps, {
          id,
          name: formatThinkingStepName(ev) || formatBrowserLiveSseStepName(ev.type),
          status: ev.ok === false ? 'error' : 'done',
          preview: ev.url || ev.output_preview,
        }),
      };
    });
  } else if (ev.type === 'browser_human_input_required') {
    setThinkingState(prev => {
      const base = prev ?? { steps: [], thinkingText: '', status: 'blocked', startedAt: Date.now() };
      return {
        ...base,
        status: 'blocked',
        steps: upsertThinkingStep(base.steps, {
          id: 'browser_human_input',
          name: formatBrowserLiveSseStepName(ev.type),
          status: 'blocked',
          preview: ev.reason || 'Complete the step, then click Continue.',
        }),
      };
    });
  } else if (ev.type === 'browser_human_input_resumed') {
    setThinkingState(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        status: 'working',
        steps: upsertThinkingStep(prev.steps, {
          id: 'browser_human_input',
          name: formatBrowserLiveSseStepName(ev.type),
          status: 'done',
        }),
      };
    });
  } else if (ev.type === 'browser_human_input_cancelled') {
    setThinkingState(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        status: 'working',
        steps: upsertThinkingStep(prev.steps, {
          id: 'browser_human_input',
          name: formatBrowserLiveSseStepName(ev.type),
          status: 'error',
        }),
      };
    });
  } else if (ev.type === 'browser_live_view_refresh') {
    setThinkingState(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        steps: upsertThinkingStep(prev.steps, {
          id: 'browser_live_view',
          name: formatBrowserLiveSseStepName(ev.type),
          status: 'done',
          preview: ev.url || ev.live_view_url,
        }),
      };
    });
  } else if (ev.type === 'browser_session_closed') {
    setThinkingState(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        steps: upsertThinkingStep(prev.steps, {
          id: 'browser_session',
          name: formatBrowserLiveSseStepName(ev.type),
          status: 'done',
        }),
      };
    });
  } else if (ev.type === 'tool_done' || ev.type === 'workflow_step') {
    const id = ev.tool_name || ev.node_key || '';
    const name = id ? formatThinkingStepName(ev) : 'Working';
    setThinkingState(prev => {
      if (!prev) return prev;
      const exists = prev.steps.find(s => s.id === id);
      const stepStatus: 'error' | 'done' = ev.ok === false ? 'error' : 'done';
      const updated = exists
        ? prev.steps.map(s => s.id === id ? { ...s, name, status: stepStatus, preview: ev.output_preview?.slice(0, 120) } : s)
        : [...prev.steps, { id, name, status: stepStatus, preview: ev.output_preview?.slice(0, 120) }];
      return { ...prev, steps: updated };
    });
  } else if (ev.type === 'tool_error') {
    setThinkingState((prev) => {
      if (!prev) return prev;
      const tn = String(ev.tool_name || '').trim();
      return {
        ...prev,
        steps: prev.steps.map((s) =>
          (tn ? s.id === tn : s.status === 'running')
            ? { ...s, status: 'error' as const }
            : s,
        ),
      };
    });
  } else if (ev.type === 'tool_blocked' || ev.type === 'approval_required') {
    if (ev.command_run_id) onApprovalRequired?.(ev.command_run_id);
    setThinkingState(prev => prev ? { ...prev, status: 'blocked' } : prev);
  } else if (ev.type === 'workflow_complete' || ev.type === 'done') {
    setThinkingState(prev => prev ? { ...prev, status: 'done' } : prev);
  } else if (ev.type === 'workflow_error' || ev.type === 'error') {
    setThinkingState(prev => prev ? { ...prev, status: 'error' } : prev);
  }
}, [onApprovalRequired, onActivePlanChange]);
  return { handleThinkingEvent };
}
