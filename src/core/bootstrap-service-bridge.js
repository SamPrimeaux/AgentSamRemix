/**
 * Worker bridge: src/ bootstrap callers ↔ backend/services/bootstrap.
 */
export {
  BOOTSTRAP_POLICY_VERSION,
  bootstrapRowId,
  parseJsonObject,
  parseJsonArray,
} from '../../backend/services/bootstrap/contract.js';

export {
  deriveCapabilitiesFromPolicy,
  deriveGovernanceRolesFromRows,
  materializeBootstrapJson,
} from '../../backend/services/bootstrap/derive.js';

export {
  resolveAgentSamBootstrap,
  resolveCanonicalAuthUserId,
  resolveCanonicalAuthUserIdByEmail,
  BOOTSTRAP_CONTEXT_MISSING,
  BOOTSTRAP_FORBIDDEN,
} from '../../backend/services/bootstrap/resolve.js';

export {
  computePolicyHash,
  computeContextHash,
  bootstrapKvCacheKey,
  bootstrapRowCacheValid,
  canonicalJsonString,
  CURRENT_BOOTSTRAP_COMPILER_VERSION,
  legacyBootstrapKvCacheKey,
  mcpAllowlistVersionKey,
  mcpPermPointerKey,
  mcpPermSnapshotKey,
  mcpPermSnapshotLookupKeys,
  mcpTokenKvKey,
} from '../../backend/services/bootstrap/hash.js';

export {
  BOOTSTRAP_KV_TTL_SECONDS,
  MCP_PERM_POINTER_TTL_SECONDS,
  getBootstrapKvCache,
  getMcpPermPointer,
  putBootstrapKvCache,
  bootstrapResultFromKvCache,
  bootstrapKvPayloadForWrite,
  mcpPermPointerPayloadForWrite,
} from '../../backend/services/bootstrap/kv-cache.js';

export {
  MCP_PERM_POINTER_PREFIX,
  MCP_PERM_SNAPSHOT_PREFIX,
  MCP_TOKEN_KV_PREFIX,
  MCP_ALLOWLIST_VERSION_PREFIX,
} from '../../backend/services/bootstrap/kv-keys.js';

export { loadUserUiPreferences, upsertUserUiPreferences } from '../../backend/services/bootstrap/ui-preferences.js';
export { refreshActorAuthorityAfterKeysChange } from '../../backend/services/bootstrap/authority-refresh.js';
export { deriveByokReadiness, normalizeByokReadinessForHash, BYOK_PROVIDER_SLUGS } from '../../backend/services/bootstrap/byok-readiness.js';
export { resolveToolCatalogGeneration, warmCatalogGenerationStamp } from '../../backend/services/bootstrap/catalog-generation.js';
export {
  readManifestGenerationStamps,
  readActorContextHashFromPointer,
  readCatalogGenerationStamp,
  readProfileGenerationStamp,
  warmProfileGenerationStamp,
  profileGenerationKvKey,
} from '../../backend/services/bootstrap/manifest-stamps.js';
export { CATALOG_GENERATION_KV_KEY, PROFILE_GENERATION_KV_PREFIX } from '../../backend/services/bootstrap/kv-keys.js';
export { computeToolManifestHash } from '../../backend/services/bootstrap/tool-manifest-hash.js';
export { resolvePlaneAuthority, planeAllowsCapability, compilePlaneAuthoritySnapshot } from '../../backend/services/bootstrap/plane-authority.js';
export { compileDelegationGrant, validateDelegationGrant } from '../../backend/services/bootstrap/grant-authority.js';
export {
  planePointerKey,
  planeSnapshotKey,
  delegationGrantKey,
  PLANE_POINTER_PREFIX,
  PLANE_SNAPSHOT_PREFIX,
  GRANT_PREFIX,
} from '../../backend/services/bootstrap/kv-keys.js';
