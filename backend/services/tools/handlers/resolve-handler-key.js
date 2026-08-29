/**
 * Resolve canonical handler identity from agentsam_tools row metadata.
 * No tool_key branching — D1 is SSOT (migration 1303+).
 */

function trim(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 */
export function resolveHandlerKeyFromRow(row) {
  const hk = trim(row?.handler_key);
  if (hk) return hk;
  const ht = trim(row?.handler_type).toLowerCase();
  return ht || 'unknown';
}

/**
 * @param {Record<string, unknown>|null|undefined} row
 * @param {Record<string, unknown>} [config]
 */
export function normalizeExecutionHandlerType(row, config = {}) {
  let handlerType = trim(row?.handler_type).toLowerCase();
  const handlerKey = trim(row?.handler_key).toLowerCase();
  const execConfig = { ...config };

  if (handlerKey === 'codebase_ast') {
    handlerType = 'codebase_ast';
  }
  if (handlerKey === 'container_exec') {
    handlerType = 'container';
  }

  if (
    (handlerType === 'hyperdrive' || handlerType === 'supabase') &&
    String(execConfig.dispatcher || '').toLowerCase().includes('semantic')
  ) {
    handlerType = 'ai';
    execConfig.legacy_unified_rag = true;
    execConfig.dispatcher = 'legacy_unified_rag';
  }

  if (
    handlerType === 'terminal' &&
    String(execConfig.target_type || '').toLowerCase() === 'my_container'
  ) {
    handlerType = 'container';
  }

  return { handlerType, execConfig };
}
