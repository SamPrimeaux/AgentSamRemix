import { isCmsCapabilityAllowed } from '../contracts/capabilities.js';

const clean = (value) => String(value ?? '').trim();

export function normalizeCmsAgentScope(scope = {}) {
  return Object.freeze({
    workspace_id: clean(scope.workspace_id ?? scope.workspaceId) || null,
    tenant_id: clean(scope.tenant_id ?? scope.tenantId) || null,
    site_id: clean(scope.site_id ?? scope.siteId ?? scope.project_slug ?? scope.projectSlug) || null,
    page_id: clean(scope.page_id ?? scope.pageId) || null,
    section_id: clean(scope.section_id ?? scope.sectionId) || null,
    block_id: clean(scope.block_id ?? scope.blockId ?? scope.component_id) || null,
  });
}

export function normalizeCmsAgentTask(input = {}) {
  const goal = clean(input.goal ?? input.prompt ?? input.instruction);
  if (!goal) throw new Error('cms_agent_goal_required');
  const requested = Array.isArray(input.capabilities) ? input.capabilities.map(clean).filter(Boolean) : [];
  const invalid = requested.filter((key) => !isCmsCapabilityAllowed(key));
  if (invalid.length) throw new Error(`cms_agent_capability_invalid:${invalid.join(',')}`);
  return Object.freeze({
    goal,
    scope: normalizeCmsAgentScope(input.scope || input),
    capabilities: Object.freeze([...new Set(requested)]),
    requested_model_key: clean(input.requested_model_key ?? input.requestedModelKey) || null,
    constraints: input.constraints && typeof input.constraints === 'object' ? Object.freeze({ ...input.constraints }) : Object.freeze({}),
    context: input.context && typeof input.context === 'object' ? Object.freeze({ ...input.context }) : Object.freeze({}),
  });
}
