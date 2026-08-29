/**
 * D1 workflow registry governance — NULL-tier uniqueness and automated-key naming.
 * @see migrations/340_agentsam_db_governance.sql
 * @see docs/db/agentsam_upsert_patterns.sql
 */

/** @typedef {'platform_global'|'tenant'|'workspace'} WorkflowIsolationTier */

/**
 * @param {string|null|undefined} tenantId
 * @param {string|null|undefined} workspaceId
 * @returns {WorkflowIsolationTier}
 */
export function workflowIsolationTier(tenantId, workspaceId) {
  const tid = tenantId != null ? String(tenantId).trim() : '';
  const wid = workspaceId != null ? String(workspaceId).trim() : '';
  if (!tid && !wid) return 'platform_global';
  if (tid && !wid) return 'tenant';
  return 'workspace';
}

/**
 * Platform-global rows must use deterministic ids (workflow_key is the usual id).
 * @param {string} workflowKey
 * @param {string|null|undefined} tenantId
 * @param {string|null|undefined} workspaceId
 * @returns {string}
 */
export function deterministicWorkflowId(workflowKey, tenantId, workspaceId) {
  const key = String(workflowKey || '').trim();
  if (!key) throw new Error('workflow_key is required');
  if (workflowIsolationTier(tenantId, workspaceId) === 'platform_global') return key;
  return key.startsWith('wf_') ? key : `wf_${key}`;
}

const AUTOMATED_KEY_MARKERS = ['_test', '_smoke', '_matrix', '_pinstest'];

/**
 * Automated/matrix/smoke writers must suffix workflow_key so bulk cleanup cannot touch canonical rows.
 * @param {string} workflowKey
 * @param {{ automated?: boolean, allowCanonical?: boolean }} [opts]
 */
export function assertAutomatedWorkflowKey(workflowKey, opts = {}) {
  const automated = opts.automated !== false;
  if (!automated || opts.allowCanonical) return;
  const key = String(workflowKey || '').trim();
  if (!key) throw new Error('workflow_key is required for automated workflow registration');
  const ok = AUTOMATED_KEY_MARKERS.some((m) => key.includes(m));
  if (!ok) {
    throw new Error(
      `automated workflow_key must include one of ${AUTOMATED_KEY_MARKERS.join(', ')} (got: ${key})`,
    );
  }
}

/**
 * @param {string} workflowKey
 * @param {string|null|undefined} tenantId
 * @param {string|null|undefined} workspaceId
 * @param {{ automated?: boolean }} [opts]
 */
export function validateWorkflowRegistryWrite(workflowKey, tenantId, workspaceId, opts = {}) {
  const key = String(workflowKey || '').trim();
  if (!key) throw new Error('workflow_key is required');
  const tier = workflowIsolationTier(tenantId, workspaceId);
  if (opts.automated) assertAutomatedWorkflowKey(key, opts);
  if (tier === 'platform_global' && opts.automated) {
    throw new Error('automated workflows must not register at platform-global tier (NULL tenant/workspace)');
  }
  return { workflowKey: key, tier, workflowId: deterministicWorkflowId(key, tenantId, workspaceId) };
}
