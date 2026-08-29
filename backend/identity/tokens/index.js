/**
 * Token transport — JWT passport only; authorization lives in bootstrap perm-snapshot.
 */

export {
  mintEdgeSessionToken,
  verifyEdgeSessionToken,
  isEdgeSessionToken,
  isLegacySessionId,
  resolveSessionFromCookieValue,
  EDGE_SESSION_TOKEN_VERSION,
} from '../../auth/session-tokens.js';

export {
  validateMcpToken,
  generateMcpToken,
} from './mcp-bearer.js';

export {
  JWT_FORBIDDEN_AUTHZ_CLAIMS,
  findForbiddenAuthzClaims,
} from '../contracts/jwt-transport-claims.js';
