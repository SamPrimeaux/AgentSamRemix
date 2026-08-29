/** Mirror tokens_in/out into the analytics token columns. */
export function syncUsageTokenColumns(tokensIn, tokensOut) {
  const tin = Math.max(0, Math.floor(Number(tokensIn) || 0));
  const tout = Math.max(0, Math.floor(Number(tokensOut) || 0));
  return {
    tokens_in: tin,
    tokens_out: tout,
    input_tokens: tin,
    output_tokens: tout,
    total_tokens: tin + tout,
  };
}

const EMBED_TASK_TYPES = new Set([
  'ast_symbol_reembed',
  'ast_rag_phase2',
  'code_index_embed',
  'codebase_full_chunk_embed',
  'codebase_full_symbol_embed',
  'embed',
]);

/**
 * Canonical usage_kind for agentsam_usage_events — computed at write, not rediscovered at read.
 * @param {{ event_type?: unknown, task_type?: unknown, model_key?: unknown, model?: unknown }} [input]
 */
export function classifyUsageKind(input = {}) {
  const eventType = String(input.event_type || '').trim().toLowerCase();
  const taskType = String(input.task_type || '').trim().toLowerCase();
  const modelKey = String(input.model_key || '').trim().toLowerCase();
  const model = String(input.model || '').trim().toLowerCase();
  if (
    eventType === 'embed' ||
    EMBED_TASK_TYPES.has(taskType) ||
    modelKey.includes('embedding') ||
    model.includes('embedding')
  ) {
    return 'embedding';
  }
  if (eventType) return eventType.slice(0, 40);
  return 'other';
}

export function resolveUsageConversationId(values = {}) {
  const candidates = [
    values.conversationId,
    values.conversation_id,
    values.sessionId,
    values.session_id,
  ];
  for (const value of candidates) {
    const normalized = value != null ? String(value).trim() : '';
    if (normalized) return normalized.slice(0, 200);
  }
  return null;
}

/**
 * Optional INSERT columns when the deployed usage schema supports them.
 *
 * @param {Set<string>} cols
 * @param {{
 *   tokens_in?: number,
 *   tokens_out?: number,
 *   task_type?: unknown,
 *   mode?: unknown,
 *   reason?: unknown,
 *   conversation_id?: unknown,
 *   event_type?: unknown,
 *   model_key?: unknown,
 *   model?: unknown,
 *   usage_kind?: unknown,
 * }} values
 */
export function usageEventExtraColumnSql(
  cols,
  { tokens_in, tokens_out, task_type, mode, reason, conversation_id, event_type, model_key, model, usage_kind },
) {
  const synced = syncUsageTokenColumns(tokens_in, tokens_out);
  const names = [];
  const placeholders = [];
  const binds = [];

  if (cols.has('input_tokens')) {
    names.push('input_tokens');
    placeholders.push('?');
    binds.push(synced.input_tokens);
  }
  if (cols.has('output_tokens')) {
    names.push('output_tokens');
    placeholders.push('?');
    binds.push(synced.output_tokens);
  }
  const conversationId =
    conversation_id != null ? String(conversation_id).trim() : '';
  if (cols.has('conversation_id') && conversationId) {
    names.push('conversation_id');
    placeholders.push('?');
    binds.push(conversationId.slice(0, 200));
  }
  const tt = task_type != null ? String(task_type).trim() : '';
  if (cols.has('task_type') && tt) {
    names.push('task_type');
    placeholders.push('?');
    binds.push(tt.slice(0, 120));
  }
  const md = mode != null ? String(mode).trim() : '';
  if (cols.has('mode') && md) {
    names.push('mode');
    placeholders.push('?');
    binds.push(md.slice(0, 64));
  }
  const rs = reason != null ? String(reason).trim() : '';
  if (cols.has('reason') && rs) {
    names.push('reason');
    placeholders.push('?');
    binds.push(rs.slice(0, 500));
  }
  if (cols.has('usage_kind')) {
    const kind =
      usage_kind != null && String(usage_kind).trim()
        ? String(usage_kind).trim().slice(0, 40)
        : classifyUsageKind({ event_type, task_type, model_key, model });
    names.push('usage_kind');
    placeholders.push('?');
    binds.push(kind);
  }
  return { names, placeholders, binds };
}
