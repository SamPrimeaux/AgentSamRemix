/**
 * Agent-mode entry: shared tool loop.
 * Skills are slash-invoked playbooks inside the normal loop — not multitask spawn.
 */

import { jsonResponse } from '../../../http/agentsam/shared.js';
import { runSharedProfileToolLoop } from './agent-controller.js';

/**
 * @param {any} env
 * @param {any} ctx
 * @param {any} input
 */
export async function executeAgentTurn(env, ctx, input) {
  const profile = input.profile;
  if (profile.mode !== 'agent') {
    return jsonResponse(
      { error: 'agent_controller_mode_mismatch', mode: profile.mode },
      400,
    );
  }
  return runSharedProfileToolLoop(env, ctx, input);
}
