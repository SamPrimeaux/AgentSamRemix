/**
 * Machine-to-machine auth SSOT: AGENTSAM_BRIDGE_KEY.
 *
 * `X-Bridge-Key` is the canonical wire header across Agent Sam services.
 * Authorization: Bearer is accepted temporarily for older machine callers,
 * but both spellings verify against the same single secret authority.
 * Human browser authentication is handled by the identity/session layer.
 */
export interface BridgeEnv {
  AGENTSAM_BRIDGE_KEY?: string;
}

function trim(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

function presentedKey(request: Request): string {
  const bridge = trim(request.headers.get('X-Bridge-Key'));
  if (bridge) return bridge;
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? trim(auth.slice(7)) : '';
}

export function verifyBridgeKey(request: Request, env: BridgeEnv): boolean {
  const expected = trim(env.AGENTSAM_BRIDGE_KEY);
  const presented = presentedKey(request);
  return Boolean(expected && presented && presented === expected);
}

export function bridgeUnauthorized(): Response {
  return new Response(JSON.stringify({ error: 'bridge_key_required' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
