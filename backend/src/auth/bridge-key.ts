/**
 * Active Worker bridge-auth adapter.
 *
 * The secret authority and principal contract live in backend/auth so every
 * Worker/CLI path recognizes the same Agent Sam service principal.
 */
import {
  machineProofHasCapability as hasCapability,
  resolveMachineProof as resolveProof,
  verifyBridgeKey as verifyKey,
} from '../../auth/bridge-key-auth.js';

export interface BridgeEnv {
  AGENTSAM_BRIDGE_KEY?: string;
}

export interface MachineProof {
  type: 'bridge';
  principalId: string;
  principalType: 'service';
  capabilities: string[];
  delegatedUserId: string | null;
}

export function verifyBridgeKey(request: Request, env: BridgeEnv): boolean {
  return verifyKey(request, env);
}

export function resolveMachineProof(
  request: Request,
  env: BridgeEnv,
): MachineProof | null {
  return resolveProof(request, env) as MachineProof | null;
}

export function machineProofHasCapability(
  proof: MachineProof | null,
  capability: string,
): boolean {
  return hasCapability(proof, capability);
}

export function bridgeUnauthorized(): Response {
  return new Response(JSON.stringify({ error: 'bridge_key_required' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
