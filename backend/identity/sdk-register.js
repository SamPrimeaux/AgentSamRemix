/**
 * SDK OAuth finalize registry — IAM registers production impl at Worker boot.
 * @see backend/identity/INTEGRATION.md
 */
import {
  registerFinalizeInboundOAuth,
  finalizeInboundOAuth,
} from '@inneranimalmedia/agentsam-sdk/identity/oauth/callback';

/**
 * @param {import('@inneranimalmedia/agentsam-sdk/identity/oauth/callback').FinalizeInboundOAuthFn} finalizeImpl
 */
export function wireOAuthFinalizeAdapter(finalizeImpl) {
  registerFinalizeInboundOAuth(finalizeImpl);
}

export { finalizeInboundOAuth };
