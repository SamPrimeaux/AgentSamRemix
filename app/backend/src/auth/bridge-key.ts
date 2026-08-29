/**
 * AGENTSAM_BRIDGE_KEY — AgentSamRemix's own internal machine-to-machine
 * authority. Plays the same architectural role inneranimalmedia's does
 * (Worker-to-Worker, Worker-to-terminal-daemon trust) but is a DISTINCT
 * secret, scoped only to this app. Never the inneranimalmedia production
 * value — see the audit two turns ago for why.
 *
 * This gates machine callers only (a localpty daemon, a VM agent process).
 * It has nothing to do with user auth — see identity/server/worker-router
 * for that. Do not use this to authenticate a human browser session.
 */

export interface BridgeEnv {
  AGENTSAM_BRIDGE_KEY?: string;
}

function trim(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function presentedKey(request: Request): string {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? trim(auth.slice(7)) : '';
}

/**
 * @returns true if the request carries a valid bridge credential.
 */
export function verifyBridgeKey(request: Request, env: BridgeEnv): boolean {
  const expected = trim(env.AGENTSAM_BRIDGE_KEY);
  if (!expected) return false;
  const presented = presentedKey(request);
  if (!presented) return false;
  return presented === expected;
}

/**
 * Standard 401 for a machine route that didn't present a valid bridge key.
 */
export function bridgeUnauthorized(): Response {
  return new Response(JSON.stringify({ error: 'bridge_key_required' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
