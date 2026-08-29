function trim(value) {
  return value == null ? '' : String(value).trim();
}

function isOwnedConversationSuffix(value) {
  const suffix = trim(value);
  if (!suffix) return false;
  // crypto.randomUUID() path used by the browser app.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suffix)) {
    return true;
  }
  // Date.now().toString(36) + random base36 fallback used by the browser app.
  return /^[a-z0-9]{6,}-[a-z0-9]{5,12}$/i.test(suffix);
}

/**
 * Matches the browser AgentShell naming contract. Conversation agents append
 * only a generated conversation suffix; arbitrary user-* prefix matches fail.
 */
export function agentNamePrefixForUser(userId) {
  const safe = trim(userId)
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 72);
  if (!safe) throw new Error('browser_user_scope_required');
  return `user-${safe}`;
}

export function resolveOwnedAgentName(userId, requestedAgentName) {
  const prefix = agentNamePrefixForUser(userId);
  const requested = trim(requestedAgentName);
  if (!requested) return prefix;
  if (requested === prefix) return requested;
  if (requested.startsWith(`${prefix}-`)) {
    const suffix = requested.slice(prefix.length + 1);
    if (isOwnedConversationSuffix(suffix)) return requested;
  }
  throw new Error('browser_agent_scope_forbidden');
}
