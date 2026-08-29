import { jsonResponse } from '../../../http/agentsam/shared.js';
import { runSharedProfileToolLoop } from './agent-controller.js';

/**
 * Multitask controller — validates Multitask mode, then enters the shared tool loop.
 *
 * @param {any} env
 * @param {any} ctx
 * @param {Record<string, unknown>} input
 */
export async function executeMultitaskTurn(env, ctx, input) {
  const profile = input.profile;
  if (profile.mode !== 'multitask') {
    return jsonResponse(
      { error: 'multitask_controller_mode_mismatch', mode: profile.mode },
      400,
    );
  }
  return runSharedProfileToolLoop(env, ctx, input);
}
