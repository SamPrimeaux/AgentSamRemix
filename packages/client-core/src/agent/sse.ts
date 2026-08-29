import type { AgentStreamEvent } from '../../../platform-contracts/src/index';

export function visibleTextFromAgentEvent(event: AgentStreamEvent): string {
  if (!event || typeof event !== 'object') return '';
  if (['done', 'error', 'tool_approval_request', 'approval_required'].includes(String(event.type || ''))) return '';
  if (typeof event.text === 'string') return event.text;
  const delta = event.delta as Record<string, unknown> | undefined;
  if (delta && typeof delta.content === 'string') return delta.content;
  if (delta?.type === 'text_delta' && typeof delta.text === 'string') return delta.text;
  const choices = event.choices as Array<{ delta?: { content?: string } }> | undefined;
  const choiceText = choices?.[0]?.delta?.content;
  if (typeof choiceText === 'string') return choiceText;
  const candidates = event.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
  return candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
}

export async function consumeSse(
  body: ReadableStream<Uint8Array>,
  handlers: { onEvent?: (event: AgentStreamEvent) => void; onText?: (text: string, event: AgentStreamEvent) => void },
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || '';
      for (const frame of frames) {
        const data = frame.split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data || data === '[DONE]') continue;
        let event: AgentStreamEvent;
        try { event = JSON.parse(data) as AgentStreamEvent; } catch { event = { type: 'text', text: data }; }
        handlers.onEvent?.(event);
        const text = visibleTextFromAgentEvent(event);
        if (text) handlers.onText?.(text, event);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
