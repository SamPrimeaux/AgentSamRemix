/**
 * AGENTSAM_BRIDGE_KEY — authoritative machine-to-machine credential (SSOT).
 *
 * Accepts the same secret via legacy header names (same plaintext as bridge):
 *   Authorization: Bearer
 *   X-Internal-Secret
 *   X-Ingest-Secret
 *   X-IAM-Service-Key
 *   X-ExecOS-Key
 *
 * Inbound verify reads only AGENTSAM_BRIDGE_KEY from env — retired Wrangler secrets
 * (INTERNAL_API_SECRET, INGEST_SECRET, IAM_SERVICE_KEY, EXECOS_KEY) are not accepted.
 */

function trim(v) {
  return v == null ? '' : String(v).trim();
}

export const AGENTSAM_PLATFORM_PRINCIPAL = Object.freeze({
  id: 'agentsam-platform',
  type: 'service',
  capabilities: Object.freeze(['retrieval.read', 'retrieval.evaluate']),
});

export function machineProofHasCapability(proof, capability) {
  const requested = trim(capability);
  return Boolean(
    proof?.type === 'bridge' &&
    requested &&
    Array.isArray(proof.capabilities) &&
    proof.capabilities.includes(requested),
  );
}

/**
 * Outbound key for platform machine-to-machine calls.
 * @param {any} env
 */
export function resolveOutboundBridgeKey(env) {
  return trim(env?.AGENTSAM_BRIDGE_KEY) || '';
}

/**
 * Configured machine-auth secrets on this Worker (bridge only).
 * @param {any} env
 * @returns {string[]}
 */
export function configuredMachineAuthSecrets(env) {
  const key = trim(env?.AGENTSAM_BRIDGE_KEY);
  return key ? [key] : [];
}

/**
 * @param {Request} request
 * @returns {string[]}
 */
export function presentedMachineAuthCredentials(request) {
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const vals = [
    bearer,
    request.headers.get('X-Internal-Secret'),
    request.headers.get('X-Ingest-Secret'),
    request.headers.get('X-IAM-Service-Key'),
    request.headers.get('X-ExecOS-Key'),
    request.headers.get('X-Bridge-Key'),
  ]
    .map(trim)
    .filter(Boolean);
  return [...new Set(vals)];
}

/**
 * @param {Request} request
 * @param {any} env
 */
export function verifyBridgeKey(request, env) {
  const expected = configuredMachineAuthSecrets(env);
  if (!expected.length) return false;
  const presented = presentedMachineAuthCredentials(request);
  if (!presented.length) return false;
  return presented.some((p) => expected.includes(p));
}

/**
 * Resolve AGENTSAM_BRIDGE_KEY as a service principal. A bridge caller is valid
 * without delegated user, tenant, workspace, or cookie identity. User delegation
 * is a separate compatibility operation and never appears in this proof.
 *
 * @param {Request} request
 * @param {any} env
 * @returns {{ type: 'bridge', principalId: string, principalType: 'service', capabilities: string[], delegatedUserId: string|null }|null}
 */
export function resolveMachineProof(request, env) {
  if (!verifyBridgeKey(request, env)) return null;
  const delegated = trim(request?.headers?.get?.('X-User-Id'));
  return {
    type: 'bridge',
    principalId: AGENTSAM_PLATFORM_PRINCIPAL.id,
    principalType: AGENTSAM_PLATFORM_PRINCIPAL.type,
    capabilities: [...AGENTSAM_PLATFORM_PRINCIPAL.capabilities],
    delegatedUserId: /^au_[A-Za-z0-9_]+$/.test(delegated) ? delegated : null,
  };
}

/**
 * Outbound headers for platform machine-to-machine calls.
 * @param {any} env
 * @param {Record<string, string>} [extra]
 */
export function buildBridgeAuthHeaders(env, extra = {}) {
  const key = resolveOutboundBridgeKey(env);
  /** @type {Record<string, string>} */
  const headers = { ...extra };
  if (key) {
    if (!headers.Authorization) headers.Authorization = `Bearer ${key}`;
    if (!headers['X-IAM-Service-Key']) headers['X-IAM-Service-Key'] = key;
  }
  return headers;
}
