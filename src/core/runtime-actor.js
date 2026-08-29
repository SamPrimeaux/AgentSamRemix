/**
 * Multi-tenant runtime identity contract.
 *
 * Every protected path should resolve an actor before side effects or D1 writes.
 * Do not substitute personal / seed tenant, workspace, or user ids — missing context is an error.
 *
 * @typedef {'dashboard'|'mcp'|'api'|'terminal'|'browser'|'cron'} RuntimeActorSource
 */

/** @typedef {{
 *   authUserId: string,
 *   userId: string,
 *   tenantId: string,
 *   workspaceId: string,
 *   personUuid: string | null,
 *   sessionId: string | null,
 *   agentId: string | null,
 *   source: RuntimeActorSource | string,
 *   action: string,
 *   toolKey: string | null,
 * }} RuntimeActor */

const AU_PREFIX = 'au_';
const TENANT_PREFIX = 'tenant_';
const WS_PREFIX = 'ws_';

export function isCanonicalAuthUserId(id) {
  const s = id != null ? String(id).trim() : '';
  return s.startsWith(AU_PREFIX) && s.length > AU_PREFIX.length + 4;
}

export function isTenantId(id) {
  const s = id != null ? String(id).trim() : '';
  return s.startsWith(TENANT_PREFIX) && s.length > TENANT_PREFIX.length;
}

export function isWorkspaceId(id) {
  const s = id != null ? String(id).trim() : '';
  return s.startsWith(WS_PREFIX) && s.length > WS_PREFIX.length;
}

/**
 * Build a RuntimeActor from `resolveIamActorContext` (see identity.js).
 * Returns null if IAM context has an error or missing user/tenant/workspace.
 *
 * @param {any} iam — return value of resolveIamActorContext
 * @param {{ source?: string, action?: string, toolKey?: string | null, agentId?: string | null }} [overrides]
 * @returns {RuntimeActor | null}
 */
export function runtimeActorFromIamContext(iam, overrides = {}) {
  if (!iam || iam.error) return null;
  const uid = iam.userId != null ? String(iam.userId).trim() : '';
  const tid = iam.tenantId != null ? String(iam.tenantId).trim() : '';
  const wid = iam.workspaceId != null ? String(iam.workspaceId).trim() : '';
  if (!uid || !tid || !wid) return null;

  const src = overrides.source != null ? String(overrides.source).trim() : 'api';
  const action = overrides.action != null ? String(overrides.action).trim() : '';
  if (!src) return null;

  return {
    authUserId: uid,
    userId: uid,
    tenantId: tid,
    workspaceId: wid,
    personUuid: iam.personUuid != null && String(iam.personUuid).trim() !== '' ? String(iam.personUuid).trim() : null,
    sessionId: iam.sessionId != null && String(iam.sessionId).trim() !== '' ? String(iam.sessionId).trim() : null,
    agentId: overrides.agentId != null && String(overrides.agentId).trim() !== '' ? String(overrides.agentId).trim() : null,
    source: src,
    action,
    toolKey: overrides.toolKey != null && String(overrides.toolKey).trim() !== '' ? String(overrides.toolKey).trim() : null,
  };
}

/**
 * True when actor satisfies prefix contract (multi-user runtime).
 * Does not require personUuid / sessionId / agentId (nullable in D1).
 *
 * @param {Partial<RuntimeActor> | null | undefined} actor
 * @param {{ requireAction?: boolean }} [opts]
 */
export function isRuntimeActorComplete(actor, opts = {}) {
  if (!actor) return false;
  const uid = actor.userId != null ? String(actor.userId).trim() : '';
  const aid = actor.authUserId != null ? String(actor.authUserId).trim() : '';
  if (!isCanonicalAuthUserId(aid) || uid !== aid) return false;
  if (!isTenantId(actor.tenantId)) return false;
  if (!isWorkspaceId(actor.workspaceId)) return false;
  const src = actor.source != null ? String(actor.source).trim() : '';
  if (!src) return false;
  if (opts.requireAction) {
    const act = actor.action != null ? String(actor.action).trim() : '';
    if (!act) return false;
  }
  return true;
}

/**
 * @param {Partial<RuntimeActor> | null | undefined} actor
 * @param {{ requireAction?: boolean }} [opts]
 * @throws {Error} code RUNTIME_ACTOR_INCOMPLETE
 */
export function assertRuntimeActor(actor, opts = {}) {
  if (!isRuntimeActorComplete(actor, opts)) {
    const err = new Error('RUNTIME_ACTOR_INCOMPLETE: resolve tenant, workspace, and au_* user before protected work');
    err.code = 'RUNTIME_ACTOR_INCOMPLETE';
    throw err;
  }
}

/**
 * Standard D1 column names for tenancy-scoped inserts (nulls where actor field absent).
 *
 * @param {RuntimeActor} actor
 * @returns {{ tenant_id: string, workspace_id: string, user_id: string, person_uuid: string | null, session_id: string | null, agent_id: string | null }}
 */
export function ledgerBindingsFromActor(actor) {
  assertRuntimeActor(actor);
  return {
    tenant_id: String(actor.tenantId).trim(),
    workspace_id: String(actor.workspaceId).trim(),
    user_id: String(actor.userId).trim(),
    person_uuid: actor.personUuid ?? null,
    session_id: actor.sessionId ?? null,
    agent_id: actor.agentId ?? null,
  };
}

/**
 * Stricter check for MCP / tool execution paths.
 * @param {Partial<RuntimeActor> | null | undefined} actor
 */
export function assertRuntimeActorForTool(actor) {
  assertRuntimeActor(actor, { requireAction: true });
  const tk = actor?.toolKey != null ? String(actor.toolKey).trim() : '';
  if (!tk) {
    const err = new Error('RUNTIME_ACTOR_INCOMPLETE: toolKey required for tool invocation');
    err.code = 'RUNTIME_ACTOR_INCOMPLETE';
    throw err;
  }
}

/**
 * MCP / ledger paths: canonical au_* user (including au_system_agent, au_service_*), tenant, workspace.
 * @param {Partial<RuntimeActor> | Record<string, unknown> | null | undefined} actor
 * @throws {Error} code ACTOR_CONTEXT_MISSING
 */
export function assertActorContext(actor) {
  const uid = actor?.userId != null ? String(actor.userId).trim() : '';
  if (!uid.startsWith(AU_PREFIX)) {
    const err = new Error('Missing canonical userId');
    err.code = 'ACTOR_CONTEXT_MISSING';
    throw err;
  }
  const tid = actor?.tenantId != null ? String(actor.tenantId).trim() : '';
  if (!tid) {
    const err = new Error('Missing tenantId');
    err.code = 'ACTOR_CONTEXT_MISSING';
    throw err;
  }
  const wid = actor?.workspaceId != null ? String(actor.workspaceId).trim() : '';
  if (!wid) {
    const err = new Error('Missing workspaceId');
    err.code = 'ACTOR_CONTEXT_MISSING';
    throw err;
  }
}
