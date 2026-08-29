/**
 * User-visible copy for agent/tool failures.
 * Internal strings (tool timeouts, dispatch codes, PTC integrity) must never
 * become the assistant bubble as if the model said them.
 */

export const USER_VISIBLE_TOOL_FAILURE =
  'Something went wrong retrieving that — try again.';

export const USER_VISIBLE_CREDENTIAL_FAILURE =
  'A required credential is missing or misconfigured for this tool. Reconnect the integration or ask an operator to check platform credentials.';

export const USER_VISIBLE_MISSING_ARG_FAILURE =
  'A required tool argument was missing — continuing from what we already found.';

/**
 * Soft catalog failure for missing required args — model continues the turn.
 * @param {string} toolName
 * @param {unknown} error
 * @param {Record<string, unknown>} [extra]
 */
export function softMissingRequiredArgResult(toolName, error, extra = {}) {
  const msg =
    typeof error === 'string'
      ? error
      : error != null
        ? JSON.stringify(error)
        : 'missing_required_arg';
  return {
    ok: false,
    soft_validation_error: true,
    code: 'missing_required_arg',
    error: msg,
    hint:
      toolName === 'fs_search_files' || String(toolName || '').includes('search_files')
        ? 'Required argument missing. Retry fs_search_files with a non-empty query (and optional path), or call fs_read_file with the active editor path. Do not call agentsam_codebase_retrieve for an empty grep.'
        : 'Required argument missing. Do not end the turn with this error — answer from prior successful tool results, or retry with a non-empty query/path.',
    tool: toolName != null ? String(toolName) : null,
    ...extra,
  };
}

/**
 * Catalog/validation codes that must not abort the turn as assistant prose
 * (e.g. model called fs_search_files with {}).
 * Allowlist only — do NOT soft-fail every missing_required_* (GitHub writes use
 * missing_required_input for repo/path/message omissions and must stay hard).
 * @param {unknown} text
 */
export function isMissingRequiredArgErrorText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  const bare = t.replace(/^Tool execution failed:\s*/i, '').trim();
  if (!bare || bare.length > 200) return false;
  if (
    /^(query required|SQL query required|path required|pattern required|name required)$/i.test(
      bare,
    )
  ) {
    return true;
  }
  if (/^query is required\b/i.test(bare)) return true;
  // Explicit search/read/preinvoke codes only (not missing_required_input / _fields / _capabilities).
  if (
    /^(missing_ids_or_query|missing_required_arg|missing_required_query|missing_required_sql|missing_required_path|missing_required_pattern|missing_required_q|missing_required_name)$/i.test(
      bare,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Worker/runtime diagnostic blobs that must never render as a chat bubble.
 * Fingerprints match stream-lifecycle close payloads, controller console lines,
 * and wrangler tail dumps — not ordinary JSON answers.
 *
 * @param {unknown} text
 */
export function isAgentRuntimeDumpText(text) {
  const t = String(text || '').trim();
  if (t.length < 40) return false;
  if (/Successfully created tail, expires at/i.test(t)) return true;
  if (/\b(?:GET|POST|PATCH|PUT|DELETE)\s+https?:\/\/\S+\s+-\s+Ok @/.test(t) && t.length > 500) {
    return true;
  }
  if (
    /\[agent[-_]?controller\]/i.test(t) &&
    /manifest_tools|terminal_lane|terminal_and_menu|native_(?:plus_codemode|vfs_codemode)/i.test(t)
  ) {
    return true;
  }
  if (/\[hook:\s*hook_/i.test(t) && /agent[-_]?controller|manifest_tools|provider_transport/i.test(t)) {
    return true;
  }
  if (
    t.length > 200 &&
    /\blast_error_code\b/.test(t) &&
    /\b(?:event_types|saw_token|provider_transport|thinking_start)\b/.test(t)
  ) {
    return true;
  }
  if (!(t.startsWith('{') || t.startsWith('['))) return false;
  try {
    const parsed = JSON.parse(t);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    if ('last_error_code' in parsed && ('event_types' in parsed || 'saw_token' in parsed)) return true;
    if ('manifest_tools' in parsed || 'native_plus_codemode' in parsed || 'native_vfs_codemode' in parsed) {
      return true;
    }
    if (typeof parsed.info === 'string' && /\[agent[-_]?controller\]/i.test(parsed.info)) return true;
    if (typeof parsed.log === 'string' && /\[hook[:\s]/i.test(parsed.log)) return true;
    if ('thinking_start' in parsed && ('provider_transport' in parsed || 'event_types' in parsed)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * True when text is an internal tool/runtime error that must not be shown as assistant prose.
 * @param {unknown} text
 */
export function isInternalAgentErrorText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isMissingRequiredArgErrorText(t)) return true;
  if (/^Tool timed out after \d+ms$/i.test(t)) return true;
  if (/^Tool execution failed:\s*/i.test(t) && /timed out after \d+ms/i.test(t)) return true;
  if (/^Tool execution failed:\s*/i.test(t) && t.length < 400) {
    // Intentional deadline explanations are user-visible (not internal noise).
    if (/Not enough time left|Agent run deadline reached/i.test(t)) return false;
    const rest = t.replace(/^Tool execution failed:\s*/i, '').trim();
    // Only hide the wrapper when the remainder is itself internal (timeout, PTC, dumps).
    // Terminal 502 / command failures must stay visible — they are not runtime dumps.
    if (!rest || rest === t) return true;
    return isInternalAgentErrorText(rest);
  }
  if (/^Agent run timed out$/i.test(t)) return true;
  if (/^apply_patch failed:/i.test(t)) return true;
  if (/openai_ptc_/i.test(t)) return true;
  if (/MODEL_DISPATCH_FAILED/i.test(t)) return true;
  if (/^__IAM_PROVIDER_HTTP__$/i.test(t)) return true;
  if (/^\[resolveCredential\]/i.test(t)) return true;
  if (isAgentRuntimeDumpText(t)) return true;
  if (/^(tool_timeout|tool_error|agent_run_timeout)$/i.test(t)) return true;
  // Short exact "Tool timed out after Nms" embedded as sole bubble content.
  if (/timed out after \d+ms/i.test(t) && t.length < 160 && !/\n/.test(t)) return true;
  return false;
}

/**
 * Map raw error / timeout / code to operator-safe assistant text.
 * @param {unknown} raw
 * @param {{ code?: string|null }} [opts]
 * @returns {string}
 */
export function synthesizeUserVisibleAgentFailure(raw, opts = {}) {
  const t = String(raw ?? '').trim();
  const code = opts.code != null ? String(opts.code) : '';
  if (/\[resolveCredential\]/i.test(t) || /credential not configured/i.test(t)) {
    return USER_VISIBLE_CREDENTIAL_FAILURE;
  }
  if (code === 'missing_required_arg' || isMissingRequiredArgErrorText(t)) {
    return USER_VISIBLE_MISSING_ARG_FAILURE;
  }
  if (
    code === 'tool_timeout' ||
    code === 'agent_run_timeout' ||
    code === 'openai_ptc_caller_integrity' ||
    code === 'openai_ptc_caller_missing' ||
    code === 'MODEL_DISPATCH_FAILED' ||
    isInternalAgentErrorText(t)
  ) {
    return USER_VISIBLE_TOOL_FAILURE;
  }
  // agent_run_deadline messages are already human-readable — keep them.
  if (code === 'agent_run_deadline' && t) return t;
  if (!t) return USER_VISIBLE_TOOL_FAILURE;
  return t;
}
