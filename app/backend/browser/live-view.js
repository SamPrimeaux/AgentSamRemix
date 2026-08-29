import { getAgentByName } from 'agents';
import { resolveOwnedAgentName } from './agent-name.js';

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
