import type { AgentPresenceState } from './presenceTypes';

export function mapSubagentRowToPresenceState(raw: string): AgentPresenceState {
  switch (String(raw || '').trim()) {
    case 'multitask_fanout':
    case 'approval_required':
    case 'failed':
    case 'complete':
    case 'task_queue':
    case 'waiting_approval':
      return raw as AgentPresenceState;
    case 'done':
      return 'complete';
    case 'subagent_spawn':
    case 'parallel_work':
    case 'delegate_subtask':
    default:
      return 'multitask_fanout';
  }
}
