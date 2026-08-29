/**
 * Temporary compatibility facade.
 * Worker front-door path policy is owned by backend/worker/front-door-policy.js.
 * Delete this file when the remaining src Worker tail no longer imports it.
 */
export {
  PUBLIC_OAUTH_PATHS,
  isPublicWorkboxPath,
  isPublicOAuthPath,
  publicOAuthRequestContext,
  isAutomationApiPath,
} from '../../backend/worker/front-door-policy.js';
