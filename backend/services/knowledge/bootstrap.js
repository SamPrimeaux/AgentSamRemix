/**
 * Knowledge bootstrap — compact model-neutral briefing for session hydration.
 */
import { retrieveKnowledge } from './retrieval.js';
import {
  emptyKnowledgePacket,
  knowledgeRefFromMemoryRow,
} from './contract/packet.js';
import { getKnowledgeGeneration } from './generation.js';
import { recordKnowledgeUseForRun } from './attribution.js';
import { fetchActiveProjectContextBlocks } from '../../agentsam/context/prompt-context.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function bootstrapId(scope) {
  const hex = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `kboot_${scope.ws || 'ws'}_${hex}`;
}

/**
 * @param {any} env
 * @param {{
 *   tenantId: string,
 *   workspaceId: string,
 *   userId: string,
 *   projectId?: string,
 *   task?: string,
 *   client?: string,
 *   tokenBudget?: number,
 *   agentRunId?: string,
 *   includeRecentExperience?: boolean,
 * }} opts
 */
export async function buildKnowledgeBootstrap(env, opts = {}) {
  const tenantId = trim(opts.tenantId);
  const workspaceId = trim(opts.workspaceId);
  const userId = trim(opts.userId);
  const task = trim(opts.task);
  const tokenBudget = Math.min(Math.max(Number(opts.tokenBudget) || 4000, 500), 12000);

  if (!env?.DB || !tenantId || !workspaceId || !userId) {
    return emptyKnowledgePacket({ ok: false, error: 'scope_required' });
  }

  const generation = await getKnowledgeGeneration(env, tenantId, workspaceId);
  const id = bootstrapId({ ws: workspaceId.slice(0, 24) });

  const retrieval = await retrieveKnowledge(env, env.DB, {
    query: task,
    tenantId,
    workspaceId,
    userId,
    projectId: opts.projectId,
    maxItems: 16,
    includeRecentExperience: opts.includeRecentExperience !== false,
    includeGlobalPolicies: true,
  });

  const packet = emptyKnowledgePacket({
    query: task || null,
    scope: { tenant_id: tenantId, workspace_id: workspaceId, project_id: opts.projectId || null },
    knowledge_generation: generation,
    bootstrap_id: id,
  });

  for (const hit of retrieval.hits || []) {
    const type = trim(hit.type).toLowerCase();
    const item = {
      id: hit.id,
      key: hit.key,
      type,
      title: hit.title,
      summary: hit.summary,
      provenance: hit.provenance,
      relevance: hit.relevance,
    };
    packet.refs.push({
      id: hit.id,
      key: hit.key,
      type,
      provenance: hit.provenance,
      created_at: hit.created_at ?? null,
      relevance: hit.relevance,
    });

    if (type === 'state') packet.current_state.push(item);
    else if (type === 'decision') packet.decisions.push(item);
    else if (type === 'policy') packet.policies.push(item);
    else if (type === 'procedure') packet.procedures.push(item);
    else if (type === 'preference') packet.preferences.push(item);
    else if (type === 'error') packet.warnings.push(item);
    else if (hit.provenance === 'experience') packet.prior_experience.push(item);
    else if (type === 'event' && hit.key?.startsWith('evolution:')) {
      packet.recent_evolution.push(item);
    } else packet.facts.push(item);
  }

  const projectBlocks = await fetchActiveProjectContextBlocks(env, {
    workspaceId,
    tenantId,
    projectId: opts.projectId,
    projectRef: opts.projectId,
    limit: 2,
  });
  for (const block of projectBlocks) {
    const item = {
      id: block.id,
      key: `state:project:${trim(opts.projectId) || 'workspace'}:context`,
      type: 'state',
      title: 'Project context',
      summary: block.text?.slice(0, 600),
      provenance: 'agentsam_project_context',
      relevance: 0.85,
    };
    if (!packet.current_state.some((x) => x.id === block.id)) {
      packet.current_state.push(item);
      packet.refs.push(knowledgeRefFromMemoryRow(item, 0.85));
    }
  }

  let tokens = 0;
  const sections = [
    packet.current_state,
    packet.decisions,
    packet.policies,
    packet.procedures,
    packet.warnings,
    packet.prior_experience,
  ];
  for (const sec of sections) {
    for (const item of sec) {
      tokens += Math.ceil(String(item.summary || item.title || '').length / 4);
    }
  }
  packet.token_estimate = tokens;
  if (tokens > tokenBudget) {
    packet.warnings.push({
      type: 'truncation',
      title: 'Bootstrap truncated',
      summary: `Estimated ${tokens} tokens exceeds budget ${tokenBudget}`,
    });
  }

  if (opts.agentRunId) {
    recordKnowledgeUseForRun(opts.agentRunId, packet.refs, { bootstrap_id: id });
  }

  return packet;
}
