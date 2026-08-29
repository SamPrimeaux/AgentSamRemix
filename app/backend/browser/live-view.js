import { getAgentByName } from 'agents';

function trim(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * Agent names are user-scoped. Conversation agents may append a random suffix,
 * but callers may never use this route to address another user's Durable Agent.
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
  if (requested === prefix || requested.startsWith(`${prefix}-`)) return requested;
  throw new Error('browser_agent_scope_forbidden');
}

async function resolveBrowserAgent(env, userId, requestedAgentName) {
  const agentName = resolveOwnedAgentName(userId, requestedAgentName);
  const agent = await getAgentByName(env.AgentSam, agentName);
  return { agent, agentName };
}

export async function getBrowserLiveView(env, { userId, agentName }) {
  const resolved = await resolveBrowserAgent(env, userId, agentName);
  const liveView = await resolved.agent.getBrowserLiveView();
  return { ...liveView, agentName: resolved.agentName };
}

export async function closeBrowserLiveView(env, { userId, agentName }) {
  const resolved = await resolveBrowserAgent(env, userId, agentName);
  const result = await resolved.agent.closeBrowserLiveView();
  return { ...result, agentName: resolved.agentName };
}
