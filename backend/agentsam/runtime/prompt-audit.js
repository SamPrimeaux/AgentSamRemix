/**
 * Privacy-preserving prompt audit. Never logs prompt contents, cookies, or keys.
 */
function estimateTokensFromChars(value) {
  return Math.ceil(String(value ?? '').length / 4);
}

function safeJsonLength(value) {
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return 0;
  }
}

function systemPromptString(systemPrompt) {
  if (systemPrompt == null) return '';
  if (typeof systemPrompt === 'string') return systemPrompt;
  try {
    return JSON.stringify(systemPrompt);
  } catch {
    return '';
  }
}

function toolNames(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.slice(0, 100)
    .filter((tool) => tool && typeof tool === 'object')
    .map((tool) => tool.name || tool.function?.name)
    .filter(Boolean)
    .map(String);
}

function auditEnabled(env) {
  const value = env?.AGENT_SAM_PROMPT_AUDIT;
  return value === true || value === 1 || String(value ?? '').toLowerCase() === 'true' || String(value) === '1';
}

/**
 * @param {any} env
 * @param {Record<string, any>} params
 * @param {string} modelKey
 * @param {Record<string, any>|null} meta
 */
export function maybeLogAgentChatPromptAudit(env, params = {}, modelKey, meta) {
  const context = params.promptAuditContext;
  if (!auditEnabled(env) && (context === undefined || context === null)) return;

  const messages = Array.isArray(params.messages) ? params.messages : [];
  const tools = Array.isArray(params.tools) ? params.tools : [];
  const systemPrompt = systemPromptString(params.systemPrompt);
  const contextSafe =
    context && typeof context === 'object'
      ? {
          route: context.route,
          agent_id: context.agent_id,
          session_id: context.session_id,
          workspace_id: context.workspace_id,
          mode: context.mode,
          intent_slug: context.intent_slug,
          capability_families: Array.isArray(context.capability_families)
            ? context.capability_families.slice(0, 32).map((value) => String(value || '').slice(0, 64))
            : undefined,
          loop_turn: context.loop_turn,
          pause_turn_continuation: context.pause_turn_continuation,
          mcp_slug: context.mcp_slug,
        }
      : {};
  const messageTokens = estimateTokensFromChars(messages);
  const toolTokens = estimateTokensFromChars(tools);
  const systemTokens = estimateTokensFromChars(systemPrompt);

  const audit = {
    source: 'agent_chat_prompt_audit',
    model_key: modelKey,
    api_platform: String(meta?.api_platform || 'unknown').toLowerCase(),
    provider: meta?.provider != null ? String(meta.provider) : null,
    provider_model_id: meta?.provider_model_id ? String(meta.provider_model_id).trim() : null,
    message_count: messages.length,
    tool_count: tools.length,
    messages_chars: safeJsonLength(messages),
    tools_chars: safeJsonLength(tools),
    system_prompt_chars: systemPrompt.length,
    estimated_message_tokens: messageTokens,
    estimated_tool_tokens: toolTokens,
    estimated_system_tokens: systemTokens,
    estimated_total_prompt_tokens: messageTokens + toolTokens + systemTokens,
    tool_names: toolNames(tools),
    ...Object.fromEntries(Object.entries(contextSafe).filter(([, value]) => value !== undefined)),
    created_at: new Date().toISOString(),
  };
  console.log('[agent_prompt_audit]', JSON.stringify(audit));
}

export { estimateTokensFromChars, safeJsonLength };
