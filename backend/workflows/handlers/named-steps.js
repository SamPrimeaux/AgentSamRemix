/**
 * named-steps.js
 * Named workflow step handler registry owned by backend/workflows.
 */

const HANDLER_MAP = new Map();

export function registerAgentStepHandler(key, fn) {
  HANDLER_MAP.set(key, fn);
}

export function isRegisteredAgentStepHandler(handlerKey) {
  return HANDLER_MAP.has(handlerKey);
}

export async function agentChatStep(env, { handler_key, input, runContext, node, smoke }) {
  const fn = HANDLER_MAP.get(handler_key);
  if (!fn) return { ok: false, error: `No handler registered for: ${handler_key}` };
  return fn(env, { input, runContext, node, smoke });
}

import {
  DUAL_VERIFIER_GATE_HANDLER_KEY,
  dualVerifierGateStep,
} from './dual-verifier-gate.js';

import {
  TICKET_CLOSE_PROOF_GATE_HANDLER_KEY,
  ticketCloseProofGateStep,
} from './ticket-close-proof-gate.js';

registerAgentStepHandler(DUAL_VERIFIER_GATE_HANDLER_KEY, dualVerifierGateStep);
registerAgentStepHandler(TICKET_CLOSE_PROOF_GATE_HANDLER_KEY, ticketCloseProofGateStep);
