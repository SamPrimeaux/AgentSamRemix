export function extractAcpPromptText(prompt) {
  if (typeof prompt === 'string') return prompt.trim();
  if (!Array.isArray(prompt)) return '';
  return prompt
    .filter((block) => block && typeof block === 'object')
    .map((block) => block.type === 'text' || typeof block.text === 'string' ? String(block.text || '') : '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function assertNotAgentRunIdAsSession(sessionId) {
  const id = String(sessionId || '').trim();
  if (id.startsWith('arun_')) {
    const error = new Error(
      'invalid_session_id: ACP sessionId must be a conversation_id, not agentsam_agent_run id',
    );
    error.code = -32602;
    throw error;
  }
}
