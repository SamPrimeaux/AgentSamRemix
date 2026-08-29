/**
 * Identity provisioning compatibility index.
 *
 * Keep imports stable while each provisioning owner remains independently
 * testable. New code should import the narrow owner under provisioning/.
 */
export { workspaceSlugFromTenantId } from './workspace/slug.js';
export {
  ensureTenantForUser,
  provisionUserWorkspace,
} from './provisioning/workspace.js';
export {
  getUserPlan,
  evaluatePlanForModelRequest,
  envWithLlmKeyOverride,
} from './provisioning/billing.js';
export {
  getUserBYOKey,
  encryptApiKeyForStorage,
  byokProviderSlugFromApiPlatform,
} from './provisioning/byok.js';
export {
  hashBridgeKey,
  generateUserBridgeKey,
  ensureUserTerminalConnection,
} from './provisioning/terminal.js';
