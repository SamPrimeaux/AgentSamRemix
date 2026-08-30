// Compatibility import for existing Remix callers. HTTP/auth behavior is SDK-owned;
// this host shim only preserves AgentSamRemix's production origin until IAM cutover.
import {
  buildBridgeHeaders,
  createBridgeClient as createSdkBridgeClient,
  resolveAgentSamBaseUrl as resolveSdkBaseUrl,
  resolveBridgeKey,
} from '@inneranimalmedia/agentsam-sdk/bridge-client';

const DEFAULT_BASE_URL = 'https://agentsamremix.inneranimalmedia.com';

export { buildBridgeHeaders, resolveBridgeKey };

export function resolveAgentSamBaseUrl(env = process.env) {
  const configured = env.AGENTSAM_BASE_URL || env.AGENTSAM_CORE_URL || env.IAM_CORE_URL;
  return resolveSdkBaseUrl(env, configured || DEFAULT_BASE_URL);
}

export function createBridgeClient(options = {}) {
  const env = options.env || process.env;
  return createSdkBridgeClient({
    ...options,
    env,
    baseUrl: options.baseUrl || resolveAgentSamBaseUrl(env),
  });
}
