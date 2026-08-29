/**
 * Session DO envelope pins — cold-compile artifacts reused on hot turns.
 * Invalidated by forceRefresh, workspace switch, or policy hash mismatch.
 */

export function coerceAllowlistKeySet(value) {
  if (value instanceof Set && value.size) return value;
  if (Array.isArray(value) && value.length) {
    const out = new Set();
    for (const k of value) {
      const t = k != null ? String(k).trim().toLowerCase() : '';
      if (t) out.add(t);
    }
    return out.size ? out : null;
  }
  return null;
}

/**
 * @param {{ userId?: string|null, workspaceId?: string|null, tenantId?: string|null, personUuid?: string|null }} scope
 */
export function buildAllowlistPinScope(scope = {}) {
  const uid = scope.userId != null ? String(scope.userId).trim() : '';
  const wid = scope.workspaceId != null ? String(scope.workspaceId).trim() : '';
  const tid = scope.tenantId != null ? String(scope.tenantId).trim() : '';
  const pid = scope.personUuid != null ? String(scope.personUuid).trim() : '';
  return [uid, wid, tid, pid].join('\0');
}

/**
 * @param {Record<string, unknown>|null|undefined} roots
 * @param {{ userId?: string|null, workspaceId?: string|null, tenantId?: string|null, personUuid?: string|null }} scope
 * @returns {Set<string>|null}
 */
export function readSessionAllowlistPin(roots, scope = {}) {
  if (!roots || typeof roots !== 'object') return null;
  const wantScope = buildAllowlistPinScope(scope);
  const pinScope =
    roots.allowlist_pin_scope != null ? String(roots.allowlist_pin_scope).trim() : '';
  if (pinScope && wantScope && pinScope !== wantScope) return null;
  const keys = roots.allowlist_key_set;
  if (!Array.isArray(keys) || !keys.length) return null;
  const out = new Set();
  for (const k of keys) {
    const t = k != null ? String(k).trim().toLowerCase() : '';
    if (t) out.add(t);
  }
  return out.size ? out : null;
}

/**
 * @param {Record<string, unknown>|null|undefined} roots
 * @param {string|null|undefined} [policyHash]
 * @returns {{ mayUsePrivilegedTerminal: boolean, hasPlatformPolicyGrant: boolean }|null}
 */
export function readSessionGrantsPin(roots, policyHash = null) {
  if (!roots || typeof roots !== 'object') return null;
  const grants = roots.session_grants;
  if (!grants || typeof grants !== 'object') return null;
  const pinHash =
    roots.session_grants_policy_hash != null
      ? String(roots.session_grants_policy_hash).trim()
      : '';
  const wantHash = policyHash != null ? String(policyHash).trim() : '';
  if (pinHash && wantHash && pinHash !== wantHash) return null;
  return {
    mayUsePrivilegedTerminal: grants.may_use_privileged_terminal === true,
    hasPlatformPolicyGrant: grants.has_platform_policy_grant === true,
  };
}

/**
 * @param {any} env
 * @param {{
 *   userId?: string|null,
 *   workspaceId?: string|null,
 *   tenantId?: string|null,
 *   personUuid?: string|null,
 * }} scope
 * @param {Record<string, unknown>|null|undefined} roots
 * @returns {Promise<Set<string>>}
 */
export async function resolveSessionAllowlistKeys(env, scope, roots = null) {
  const pinned = readSessionAllowlistPin(roots, scope);
  if (pinned) return pinned;
  const ws = scope.workspaceId != null ? String(scope.workspaceId).trim() : '';
  if (!env?.DB || !ws) return new Set();
  const { collectAllowlistToolKeysForScope } = await import('./agent-policy.js');
  return collectAllowlistToolKeysForScope(env.DB, scope);
}

/**
 * @param {any} env
 * @param {{
 *   userId?: string|null,
 *   workspaceId?: string|null,
 *   authUser?: Record<string, unknown>|null,
 * }} p
 * @param {Record<string, unknown>|null|undefined} roots
 * @param {string|null|undefined} [policyHash]
 */
export async function resolveSessionWorkspaceGrants(env, p, roots = null, policyHash = null) {
  const pinned = readSessionGrantsPin(roots, policyHash);
  if (pinned) return pinned;
  const uid = p.userId != null ? String(p.userId).trim() : '';
  const wid = p.workspaceId != null ? String(p.workspaceId).trim() : '';
  if (!env?.DB || !uid || !wid) {
    return { mayUsePrivilegedTerminal: false, hasPlatformPolicyGrant: false };
  }
  const { userMayUsePrivilegedTerminal, userHasPolicyGrant } = await import(
    '../../backend/identity/workspace/grants.js'
  );
  const authRow =
    p.authUser && typeof p.authUser === 'object' ? p.authUser : { id: uid };
  const [mayUsePrivilegedTerminal, hasPlatformPolicyGrant] = await Promise.all([
    userMayUsePrivilegedTerminal(env, authRow, wid),
    userHasPolicyGrant(env, uid, wid),
  ]);
  return { mayUsePrivilegedTerminal, hasPlatformPolicyGrant };
}

/**
 * @param {Set<string>|null|undefined} keys
 * @param {{ userId?: string|null, workspaceId?: string|null, tenantId?: string|null, personUuid?: string|null }} scope
 */
export function buildAllowlistPinFields(keys, scope) {
  const list = keys && keys.size ? [...keys].sort() : [];
  return {
    allowlist_key_set: list,
    allowlist_pin_scope: buildAllowlistPinScope(scope),
  };
}

/**
 * @param {{ mayUsePrivilegedTerminal?: boolean, hasPlatformPolicyGrant?: boolean }} grants
 * @param {string|null|undefined} policyHash
 */
export function buildSessionGrantsPinFields(grants, policyHash) {
  return {
    session_grants: {
      may_use_privileged_terminal: grants.mayUsePrivilegedTerminal === true,
      has_platform_policy_grant: grants.hasPlatformPolicyGrant === true,
    },
    session_grants_policy_hash:
      policyHash != null ? String(policyHash).trim() || null : null,
  };
}
