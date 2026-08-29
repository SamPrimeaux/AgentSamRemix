import { cmsCapabilityRequiresApproval, getCmsCapability } from '../contracts/capabilities.js';

const obj = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export function normalizeCmsAgentOperation(input, index = 0) {
  const row = obj(input);
  const capability = String(row.capability || row.operation || '').trim();
  const definition = getCmsCapability(capability);
  if (!definition) throw new Error(`cms_agent_operation_invalid:${capability || index}`);
  const target = obj(row.target);
  return Object.freeze({
    id: String(row.id || `op_${index + 1}`).trim(),
    capability,
    target: Object.freeze({
      site_id: String(target.site_id ?? target.siteId ?? '').trim() || null,
      page_id: String(target.page_id ?? target.pageId ?? '').trim() || null,
      section_id: String(target.section_id ?? target.sectionId ?? '').trim() || null,
      block_id: String(target.block_id ?? target.blockId ?? target.component_id ?? '').trim() || null,
    }),
    input: Object.freeze({ ...obj(row.input) }),
    reason: String(row.reason || '').trim() || null,
    risk: definition.risk,
    requires_approval: cmsCapabilityRequiresApproval(capability),
  });
}

export function normalizeCmsAgentProposal(input = {}) {
  const row = obj(input);
  const operations = Array.isArray(row.operations) ? row.operations.map(normalizeCmsAgentOperation) : [];
  if (!operations.length) throw new Error('cms_agent_operations_required');
  return Object.freeze({
    version: 1,
    summary: String(row.summary || '').trim() || null,
    operations: Object.freeze(operations),
    notes: Array.isArray(row.notes) ? Object.freeze(row.notes.map(String)) : Object.freeze([]),
  });
}
