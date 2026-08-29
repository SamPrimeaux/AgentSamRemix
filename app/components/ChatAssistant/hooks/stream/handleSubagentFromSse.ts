/**
 * Antigravity step events + real agentsam_subagent_* SSE events.
 * Antigravity as primary model must NOT invent a subagent_slug / SUBAGENTS chip.
 */
import type { SubagentAttribution } from '../../types';
import type { SseSession, SseDispatchResult } from './sseTypes';

export function handleSubagentFromSse(s: SseSession, data: unknown, evType: string | undefined): SseDispatchResult {
  if (typeof evType === 'string' && evType.startsWith('antigravity_') && data && typeof data === 'object') {
    s.emptyRun = 0;
    // Stream remote-sandbox steps into the main transcript — not the subagent pane.
    if (evType === 'antigravity_step') {
      const step = (data as { step?: { title?: string; detail?: string } }).step;
      const title = step?.title ? String(step.title).trim() : 'Antigravity';
      const detail = step?.detail ? String(step.detail).trim() : '';
      if (detail) {
        s.ctx.setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          const line = `**${title}:** ${detail.slice(0, 400)}`;
          if (last?.role === 'assistant') {
            next[next.length - 1] = {
              ...last,
              content: `${last.content}${last.content.trim() ? '\n\n' : ''}${line}`,
            };
          } else {
            next.push({ role: 'assistant', content: line });
          }
          return next;
        });
      }
    }
    return 'continue';
  }
  if (typeof evType === 'string' && evType.startsWith('agentsam_subagent_') && data && typeof data === 'object') {
    // Multitask emits structured non-text events; surface a short line and
    // reset s.emptyRun so the stream isn't treated as "stuck".
    s.emptyRun = 0;
    const d = data as Record<string, unknown>;
    const fanoutId = typeof d.fanout_id === 'string' ? d.fanout_id.trim() : '';
    const slug = typeof d.subagent_slug === 'string' ? d.subagent_slug.trim() : '';
    const status = typeof d.status === 'string' ? d.status.trim() : '';
    const subagentRunId = typeof d.subagent_run_id === 'string' ? d.subagent_run_id.trim() : '';
    const childObj =
      d.child && typeof d.child === 'object' ? (d.child as Record<string, unknown>) : null;
    const nestedChildConv =
      childObj && typeof childObj.conversation_id === 'string'
        ? childObj.conversation_id.trim()
        : '';
    const conversationId =
      typeof d.conversation_id === 'string' && d.conversation_id.trim()
        ? d.conversation_id.trim()
        : typeof d.session_id === 'string' && d.session_id.trim()
          ? d.session_id.trim()
          : nestedChildConv;
    const taskTitle =
      typeof (d.task as { title?: string } | undefined)?.title === 'string'
        ? String((d.task as { title?: string }).title).trim()
        : typeof d.task_title === 'string'
          ? d.task_title.trim()
          : '';
    s.ctx.onSubagentEvent?.({
      type: evType,
      fanout_id: fanoutId || undefined,
      subagent_slug: slug || undefined,
      subagent_run_id: subagentRunId || undefined,
      status: status || undefined,
      conversation_id: conversationId || undefined,
      task_title: taskTitle || undefined,
    });
    // Durable cyan From/Finished attribution — do not dump plain status into content.
    const isTerminalResult =
      evType === 'agentsam_subagent_run_result' ||
      evType === 'agentsam_subagent_fanout_result' ||
      evType === 'agentsam_subagent_action_required';
    if (isTerminalResult && (slug || taskTitle)) {
      const label = (taskTitle || slug).slice(0, 40);
      const kind: SubagentAttribution['status'] =
        evType === 'agentsam_subagent_action_required'
          ? 'action_required'
          : status === 'failed'
            ? 'failed'
            : 'finished';
      s.ctx.setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        const attr: SubagentAttribution = {
          runId: subagentRunId || `${slug}-${fanoutId || 'fanout'}`,
          slug: slug || 'subagent',
          label,
          conversationId: conversationId || null,
          status: kind,
        };
        if (last?.role === 'assistant') {
          const prevAttrs = Array.isArray(last.subagentAttributions)
            ? last.subagentAttributions
            : [];
          next[next.length - 1] = {
            ...last,
            subagentAttributions: [...prevAttrs.filter((a) => a.runId !== attr.runId), attr],
          };
        } else {
          next.push({
            role: 'assistant',
            content: '',
            subagentAttributions: [attr],
          });
        }
        return next;
      });
    }
    return 'continue';
  }
  return 'fallthrough';
}
