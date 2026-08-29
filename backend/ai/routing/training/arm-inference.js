/**
 * Pure attribution helpers for routing-training events.
 *
 * Database lookup and arm creation belong to apply-events. This module only
 * decides how an outcome should be labeled once the caller has its candidates.
 */

function text(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * Prefer a global policy arm for learning while retaining the selected arm
 * for audit metadata.
 *
 * @param {{
 *   selectedArmId?: string|null,
 *   globalArmId?: string|null,
 *   modelKey?: string|null,
 *   workspaceId?: string|null,
 *   taskType?: string|null,
 * }} input
 */
export function inferArmAttribution(input = {}) {
  const selectedArmId = text(input.selectedArmId) || null;
  const globalArmId = text(input.globalArmId) || null;
  const modelKey = text(input.modelKey) || null;
  const workspaceId = text(input.workspaceId) || null;
  const taskType = text(input.taskType) || null;

  return {
    selectedArmId,
    learnedArmId: globalArmId || selectedArmId,
    attribution: globalArmId ? 'global_policy_arm' : 'selected_arm',
    modelKey,
    workspaceId,
    taskType,
  };
}

/**
 * Normalize the stable identity shared by all training event producers.
 */
export function normalizeTrainingScope(input = {}) {
  return {
    workspaceId: text(input.workspaceId) || null,
    tenantId: text(input.tenantId) || null,
    taskType: text(input.taskType) || null,
    mode: text(input.mode) || 'agent',
    modelKey: text(input.modelKey) || null,
    provider: text(input.provider) || null,
  };
}
