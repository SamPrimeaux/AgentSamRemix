/**
 * Map MCP / catalog execution envelopes to agentsam_tool_call_log status.
 */

/**
 * @param {Record<string, unknown>} fields
 */
export function resolveToolCallLogStatusFromMcpFields(fields) {
  const denial = fields?.denial_code ?? fields?.denialCode;
  if (denial != null && String(denial).trim() !== '') return 'blocked';

  const statusRaw = String(fields?.status || '').toLowerCase().trim();
  const nonTerminal = new Set([
    'pending',
    'awaiting_approval',
    'pending_approval',
    'in_flight',
    'running',
    'queued',
  ]);
  if (nonTerminal.has(statusRaw)) return 'pending';
  if (statusRaw === 'success' || statusRaw === 'completed' || statusRaw === 'ok') return 'success';
  if (statusRaw === 'error' || statusRaw === 'failed') return 'error';
  if (statusRaw === 'blocked') return 'blocked';
  if (statusRaw === 'timeout') return 'timeout';
  if (fields?.success !== undefined) return fields.success ? 'success' : 'error';
  return fields?.error_message || fields?.errorMessage ? 'error' : 'success';
}

/**
 * @param {Record<string, unknown>} fields
 */
export function mcpFieldsTerminalFailure(fields) {
  const statusRaw = String(fields?.status || '').toLowerCase().trim();
  if (
    statusRaw === 'pending' ||
    statusRaw === 'awaiting_approval' ||
    statusRaw === 'pending_approval' ||
    statusRaw === 'in_flight' ||
    statusRaw === 'running' ||
    statusRaw === 'queued'
  ) {
    return false;
  }
  return fields?.success !== undefined
    ? !fields.success
    : !!(fields?.error_message || fields?.errorMessage) || statusRaw === 'error';
}
