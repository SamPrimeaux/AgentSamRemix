/**
 * AgentSamRemix identity kernel.
 *
 * Current authority:
 * - request/session transport: Agent Sam SDK identity router
 * - portable identity contracts: this domain
 * - OAuth credential storage/refresh: this domain
 *
 * The SDK transport can later be retired without changing these contracts.
 */

export * from './contracts/index.js';
export * as oauth from './oauth/index.js';

export {
  ensureOauthTokenColumns,
  upsertOauthToken,
  resolveOAuthAccessToken,
  resolveOAuthRefreshToken,
  getIntegrationOAuthRow,
  resolveCloudflareOAuthToken,
  getOAuthToken,
} from './oauth/index.js';

export {
  identityContextFromSdkSession,
} from './request-context.js';
