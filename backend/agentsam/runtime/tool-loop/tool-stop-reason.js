export function normalizeOpenAiToolStopReason(finishReason, pendingToolCallCount = 0) {
  if (Number(pendingToolCallCount) > 0) return 'tool_use';
  const reason = String(finishReason || '').trim();
  // Gemini maps TOOL_CODE_EXECUTION → finish_reason tool_calls with zero client
  // tool_calls — treat as end_turn so the host does not wait on empty tool_use.
  if (reason === 'tool_use' || reason === 'tool_calls') return 'end_turn';
  if (!reason || reason === 'stop' || reason === 'end_turn' || reason === 'completed') {
    return 'end_turn';
  }
  return reason;
}
