import { consumeReadableWithAbort } from '../../run-cancel.js';

export function extractWorkersAiLineToken(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const firstChoice = Array.isArray(obj.choices) ? obj.choices[0] : null;
  const token =
    firstChoice?.delta?.content ??
    firstChoice?.text ??
    (typeof obj.response === 'string'
      ? obj.response
      : obj.response != null
        ? String(obj.response)
        : '') ??
    '';
  return typeof token === 'string' ? token : String(token || '');
}

export async function consumeWorkersAiText(readable, {
  assistantContent,
  emit,
  abortScope,
  usage,
}) {
  usage.reset();
  const decoder = new TextDecoder();
  let buf = '';

  const consumeLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let piece = '';
    try {
      const obj = JSON.parse(trimmed);
      usage.note(obj);
      piece = extractWorkersAiLineToken(obj);
    } catch {
      piece = trimmed;
    }
    if (!piece) return;
    const last = assistantContent.findLast((block) => block.type === 'text');
    if (last) last.text += piece;
    emit('text', { text: piece });
  };

  await consumeReadableWithAbort(readable, (value) => {
    buf += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, newline);
      buf = buf.slice(newline + 1);
      consumeLine(line);
    }
  }, {
    throwIfAborted: () => abortScope.throwIfAborted(),
    signal: abortScope.signal,
  });
  consumeLine(buf);
  usage.flush();
}
