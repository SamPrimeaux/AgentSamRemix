/**
 * Worker boot: register SDK OAuth finalize adapter.
 * Imported from src/index.js (worker-composition → backend).
 */
import { wireOAuthFinalizeAdapter } from './sdk-register.js';

export {
  finalizeInboundOAuth,
  revokeIncomingCookieSession,
  safeDashboardLoginRedirectPath,
  oauthPostLoginGlobeRedirectUrl,
} from './oauth-finalize.js';

export { createIamPasswordResetServiceForEnv } from './password-reset-env.js';

import { finalizeInboundOAuth } from './oauth-finalize.js';

wireOAuthFinalizeAdapter(finalizeInboundOAuth);
