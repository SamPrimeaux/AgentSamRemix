import { jsonResponse } from '../../../http/agentsam/shared.js';
import { runSharedProfileToolLoop } from './agent-controller.js';

/**
 * Debug controller
 * - purpose: evidence-first fix with visible phase gates via debug_policy
 *
 * Initial implementation wraps the shared agent tool loop; tool gating is enforced
 * by validateToolCall(profile, toolCall) in the hot path.
 *
 * @param {any} env
 * @param {any} ctx
 * @param {any} input
 */
export async function executeDebugTurn(env, ctx, input) {
  const profile = input.profile;
  if (profile.mode !== 'debug') {
    return jsonResponse(
      { error: 'debug_controller_mode_mismatch', mode: profile.mode },
      400,
    );
  }
  return runSharedProfileToolLoop(env, ctx, input);
}

