import { normalizeCmsAgentTask } from './task.js';
import { normalizeCmsAgentProposal } from './proposal.js';

export function createCmsAgentService(deps = {}) {
  if (!deps.ai || typeof deps.ai.propose !== 'function') throw new Error('cms_agent_ai_provider_required');
  return Object.freeze({
    async propose(input) {
      const task = normalizeCmsAgentTask(input);
      const proposal = normalizeCmsAgentProposal(await deps.ai.propose(task));
      if (task.capabilities.length) {
        const allowed = new Set(task.capabilities);
        const denied = proposal.operations.filter((operation) => !allowed.has(operation.capability));
        if (denied.length) throw new Error(`cms_agent_capability_not_requested:${denied.map((operation) => operation.capability).join(',')}`);
      }
      return proposal;
    },
    async execute(proposalInput, opts = {}) {
      if (!deps.capabilities || typeof deps.capabilities.execute !== 'function') throw new Error('cms_agent_capability_executor_required');
      const proposal = normalizeCmsAgentProposal(proposalInput);
      const results = [];
      for (const operation of proposal.operations) {
        if (operation.requires_approval && opts.approved !== true) {
          results.push({ id: operation.id, capability: operation.capability, status: 'approval_required' });
          continue;
        }
        results.push({ id: operation.id, capability: operation.capability, status: 'completed', result: await deps.capabilities.execute(operation) });
      }
      return { ok: true, proposal, results };
    },
  });
}
