/**
 * Backend Agent service boundary.
 *
 * Keep this envelope explicit so route families cannot accidentally fall back
 * to a legacy loader or silently construct a partial runtime.
 */
import {
  composeChatServices,
  composePlanServices,
} from './plan-services.js';

/**
 * @param {{
 *   planModules?: Record<string, any>,
 *   chatModules?: Record<string, any>
 * }} options
 */
export function composeAgentServices(options = {}) {
  const planServices = composePlanServices(options.planModules || {});
  const chatServices = composeChatServices({
    ...(options.chatModules || {}),
    planServices,
  });
  return { planServices, chatServices };
}
