/**
 * Keep completed tool traces on the assistant bubble that produced them.
 * Live `toolTraceRows` is only the current turn — a retry must not wipe history.
 */
import type { AgentToolTraceRow } from '../components/ChatAssistant/execution/types';
import type { Message } from '../components/ChatAssistant/types';
import { traceRowCadJobLive } from './cadToolTrace';

export function completedToolTracesForPersist(rows: AgentToolTraceRow[] | null | undefined): AgentToolTraceRow[] {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.filter((r) => !traceRowCadJobLive(r)).map((r) => ({ ...r }));
}

export function attachCompletedToolTracesToLastAssistant(
  messages: Message[],
  rows: AgentToolTraceRow[] | null | undefined,
): Message[] {
  const completed = completedToolTracesForPersist(rows);
  if (!completed.length) return messages;
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i].role !== 'assistant') continue;
    const existing = Array.isArray(next[i].toolTraces) ? next[i].toolTraces : [];
    const seen = new Set(existing.map((r) => r.id));
    const merged = [...existing];
    for (const row of completed) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
    }
    next[i] = { ...next[i], toolTraces: merged };
    break;
  }
  return next;
}

export function resolveAssistantToolTraces(
  msg: Pick<Message, 'toolTraces'>,
  isLastAssistant: boolean,
  liveRows: AgentToolTraceRow[] | null | undefined,
): AgentToolTraceRow[] {
  if (isLastAssistant && Array.isArray(liveRows) && liveRows.length) return liveRows;
  return Array.isArray(msg.toolTraces) ? msg.toolTraces : [];
}
