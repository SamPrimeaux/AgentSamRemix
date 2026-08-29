/**
 * Experience → semantic knowledge curator.
 * Writes ONLY via executeAgentsamMemoryCommit — never raw INSERT to agentsam_memory.
 */
import { executeAgentsamMemoryCommit } from '../../../../src/core/agentsam-memory-commit.js';
import { proposeMemoryKey, normalizeMemoryCommitType } from '../../../../src/core/agentsam-memory-contract.js';
import { failureCategoryMovesBandit, normalizeFailureCategory } from '../../../../src/core/reward-failure-category.js';
import { workspacePrimaryProjectKey } from '../../../agentsam/context/prompt-context.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function parseTextPayload(mcpStyle) {
  const text = mcpStyle?.content?.[0]?.text;
  if (typeof text !== 'string') return mcpStyle;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: 'unparseable_memory_response' };
  }
}

/**
 * Deterministic lesson candidates from experience — no LLM.
 * @param {Record<string, unknown>} exp
 * @returns {Array<Record<string, unknown>>}
 */
export function deriveKnowledgeCandidatesFromExperience(exp) {
  const candidates = [];
  const fc = normalizeFailureCategory(exp.failure_category);
  const err = trim(exp.error_message).toLowerCase();
  const ws = trim(exp.workspace_id);
  const projectKey = workspacePrimaryProjectKey(ws);

  if (fc === 'platform_request_error') {
    return candidates;
  }

  if (
    err.includes('wrong cwd') ||
    err.includes('wrong-cwd') ||
    err.includes('inneranimalmedia') && err.includes('cwd')
  ) {
    candidates.push({
      memory_type: 'procedure',
      memory_key: 'procedure:terminal:inneranimalmedia-local-cwd',
      title: 'Use inneranimalmedia repo root for IAM terminal work',
      content:
        'Before wrangler deploy or git operations on IAM, cwd must resolve to the inneranimalmedia checkout — not $HOME or a stray worktree path.',
      importance: 8,
      tags: ['terminal', 'deploy', 'cwd'],
      source: 'experience_curator',
    });
  }

  if (err.includes('wrangler') && (err.includes('deploy') || err.includes('failed'))) {
    candidates.push({
      memory_type: 'error',
      memory_key: `error:deploy:wrangler:${projectKey || 'workspace'}`,
      title: 'Wrangler deploy failure pattern',
      content: `Deploy failed during ${trim(exp.task_type) || 'agent'} run: ${trim(exp.error_message).slice(0, 400)}`,
      importance: 7,
      tags: ['deploy', 'wrangler'],
      source: 'experience_curator',
    });
  }

  if (
    trim(exp.outcome) === 'useful_success' &&
    Number(exp.cost_usd) > 0 &&
    Number(exp.cost_usd) < 0.02 &&
    trim(exp.task_type)
  ) {
    candidates.push({
      memory_type: 'decision',
      memory_key: `decision:model_strategy:${trim(exp.task_type)}:${trim(exp.model_key) || 'unknown'}`,
      title: `Low-cost success: ${trim(exp.task_type)} with ${trim(exp.model_key) || 'model'}`,
      content: `Successful ${trim(exp.task_type)} completed for ~$${Number(exp.cost_usd).toFixed(4)} using ${trim(exp.model_key) || 'selected model'} (${exp.tool_call_count || 0} tools).`,
      importance: 6,
      tags: ['economics', 'routing'],
      source: 'experience_curator',
    });
  }

  if (fc === 'tool_execution_error' && err.includes('tool_outcome')) {
    candidates.push({
      memory_type: 'error',
      memory_key: `error:tool:${projectKey || ws}:soft_fail`,
      title: 'Tool soft-fail during agent run',
      content: trim(exp.error_message).slice(0, 500) || 'Tool returned non-ok outcome.',
      importance: 6,
      tags: ['tools'],
      source: 'experience_curator',
    });
  }

  return candidates.slice(0, 3);
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} exp
 */
export async function curateKnowledgeFromExperience(env, exp) {
  if (!env?.DB) return { ok: false, reason: 'no_db' };
  const fc = normalizeFailureCategory(exp.failure_category);
  if (fc && !failureCategoryMovesBandit(fc) && trim(exp.outcome) === 'infrastructure_failure') {
    return { ok: true, skipped: true, reason: 'platform_failure_no_model_lesson' };
  }

  const candidates = deriveKnowledgeCandidatesFromExperience(exp);
  if (!candidates.length) return { ok: true, skipped: true, reason: 'no_lesson' };

  const tenantId = trim(exp.tenant_id);
  const workspaceId = trim(exp.workspace_id);
  const userId = trim(exp.user_id) || 'system';
  if (!tenantId || !workspaceId) return { ok: false, reason: 'scope_required' };

  const workspace = {
    tenant_id: tenantId,
    user_id: userId,
    workspace_id: workspaceId,
  };

  const committed = [];
  for (const cand of candidates) {
    const memoryKey = proposeMemoryKey({
      memory_type: cand.memory_type,
      memory_key: cand.memory_key,
      title: cand.title,
      content: cand.content,
      tags: cand.tags,
    });
    const out = await executeAgentsamMemoryCommit(
      env,
      env.DB,
      workspace,
      {
        memory_key: memoryKey,
        key: memoryKey,
        memory_type: normalizeMemoryCommitType(cand.memory_type),
        title: cand.title,
        content: cand.content,
        summary: cand.content.slice(0, 280),
        importance: cand.importance,
        tags: cand.tags,
        scope_type: 'workspace',
        scope_id: workspaceId,
        source: cand.source || 'experience_curator',
        source_type: 'experience',
        source_ref: JSON.stringify({
          experience_id: exp.experience_id,
          agent_run_id: exp.agent_run_id,
        }),
        idempotency_key: `exp_curator:${exp.experience_id}:${memoryKey}`,
      },
      { eager: true },
    );
    const body = parseTextPayload(out);
    committed.push({ memory_key: memoryKey, result: body });
  }

  return { ok: true, committed_count: committed.length, committed };
}
