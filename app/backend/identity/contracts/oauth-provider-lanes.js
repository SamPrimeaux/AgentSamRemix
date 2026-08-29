/**
 * OAuth provider lanes — credential storage vs purpose.
 * SSOT prose: docs/platform/identity-substrate-2026-08.md
 *
 * user_oauth_tokens stays the table name. provider=iam is first-class like google/github.
 *
 * @module backend/identity/contracts/oauth-provider-lanes
 */

/** @typedef {'login'|'delegation'|'integration'} ConnectionPurpose */

/** Inbound IdP providers IAM recognizes at login.finalize */
export const LOGIN_IDP_PROVIDERS = Object.freeze([
  'google',
  'github',
  'iam',
  'email_password', // no user_oauth_tokens row; auth_users + auth_sessions only
]);

/** Providers stored in user_oauth_tokens (credential material IAM holds). */
export const OAUTH_TOKEN_PROVIDERS = Object.freeze([
  'google',
  'google_drive',
  'google_gmail',
  'google_calendar',
  'github',
  'github_app',
  'cloudflare',
  'iam',
]);

/**
 * Proposed connection_purpose values (column not migrated yet).
 * @type {readonly ConnectionPurpose[]}
 */
export const CONNECTION_PURPOSES = Object.freeze(['login', 'delegation', 'integration']);

/**
 * Tables by job — prevents conflating credential storage with request auth.
 */
export const IDENTITY_TABLE_ROLES = Object.freeze({
  human: 'auth_users',
  idpLinkage: 'account_identities',
  browserProof: 'auth_sessions',
  inboundCredentials: 'user_oauth_tokens',
  outboundOidcTokens: 'oauth_identity_tokens',
  mcpBearer: 'mcp_workspace_tokens',
  integrationUx: 'integration_connections',
  workspaceRelationship: 'workspace_members',
  capabilityFlags: 'memberships',
  agentPolicy: 'agentsam_user_policy',
  governance: 'user_governance_roles',
});

/**
 * Authority paths scheduled for removal — not credential tables.
 * @type {readonly string[]}
 */
export const DEPRECATED_AUTHORITY_PATHS = Object.freeze([
  'platform_operators',
  'superadmin_identity',
  'superadmin_accounts',
  'admin',
  'auth_users.is_superadmin bypass',
  'agentsam_user_policy.platform_operator as person-class',
]);
