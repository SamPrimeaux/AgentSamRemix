/**
 * Worker-side AgentSession DO stub resolution (no message logic).
 *
 * @module backend/agentsam/sessions/do-stub
 */

export function getAgentSessionStub(env, conversationId) {
  if (!env?.AGENT_SESSION) return null;
  const convId = String(conversationId || '').trim();
  if (!convId) return null;
  return env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(convId));
}

/**
 * @param {Promise<Response|null>} fetchPromise
 * @param {number} [timeoutMs]
 */
export async function withDoFetchTimeout(fetchPromise, timeoutMs = 5000) {
  const ms = Math.max(500, Number(timeoutMs) || 5000);
  return Promise.race([
    fetchPromise,
    new Promise((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}
