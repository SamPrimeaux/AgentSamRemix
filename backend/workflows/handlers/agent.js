import { dispatchComplete } from '../../agentsam/runtime/provider-dispatch.js';
import { resolveModelForTask, normalizeCanonicalTaskType } from '../../../src/core/resolveModel.js';
import { buildWorkflowParamRoot } from './common.js';

export async function executeWorkflowAgent(env, handlerKey, input, runContext, _node, config = {}) {
  if (runContext?.smoke) return { ok: true, output: { smoke: true, skipped: true, note: 'agent smoke short-circuit' } };
  try {
    const paramRoot = buildWorkflowParamRoot(input, runContext);
    const parts = String(handlerKey || '').split('.');
    const taskType = normalizeCanonicalTaskType(config.task_type ?? parts[1] ?? parts[0] ?? null) ?? 'agent';
    const mode = config.mode ?? null;
    const workspaceId = String(runContext?.runMeta?.workspaceId ?? runContext?.workspaceId ?? '').trim();
    const tenantId = runContext?.runMeta?.tenantId ?? runContext?.tenantId ?? undefined;
    let modelKey = config.model_key || null;
    let resolvedArm = null;
    if (!modelKey && env?.DB && workspaceId) {
      try {
        resolvedArm = await resolveModelForTask(env, {
          task_type: taskType,
          mode,
          workspace_id: workspaceId,
          tenant_id: tenantId,
        });
        modelKey = resolvedArm?.model_key ?? null;
      } catch (e) {
        console.warn('[workflow] resolveModelForTask', e?.message ?? e);
      }
    }
    if (!modelKey && env?.DB) {
      const arm = await env.DB.prepare(
        `SELECT model_key FROM agentsam_routing_arms
          WHERE COALESCE(TRIM(workspace_id), '') = '' AND task_type = ?
            AND is_active = 1 AND is_eligible = 1
            AND COALESCE(is_paused,0)=0 AND COALESCE(budget_exhausted,0)=0
          ORDER BY (success_alpha * 1.0 / (success_alpha + success_beta)) DESC LIMIT 1`,
      ).bind(taskType).first().catch(() => null);
      modelKey = arm?.model_key ?? null;
    }
    if (!modelKey) return { ok: false, error: `agent node: no model resolved for task_type=${taskType} workspace=${workspaceId || '(missing)'}` };

    const userMessage = typeof input === 'string'
      ? input
      : config.user_message_field
        ? paramRoot[config.user_message_field]
        : paramRoot.prompt || paramRoot.message || paramRoot.instruction || paramRoot.capture || paramRoot.result || JSON.stringify(paramRoot);

    const result = await dispatchComplete(env, {
      modelKey,
      taskType,
      mode,
      systemPrompt: config.system_prompt || 'You are Agent Sam for Inner Animal Media. Complete the workflow node and return concise structured output.',
      messages: [{ role: 'user', content: String(userMessage ?? '').slice(0, 12000) }],
      userId: runContext?.canonicalUserId ?? paramRoot.user_id,
      options: config.options || { reasoningEffort: 'medium', verbosity: 'low' },
    });
    const text = result?.text || result?.content?.[0]?.text || result?.output || JSON.stringify(result);
    return {
      ok: true,
      output: { result: text, model: result?.model, usage: result?.usage },
      model: result?.model,
      tokens: result?.usage,
      resolvedArm,
    };
  } catch (e) {
    return { ok: false, error: `agent node failed: ${e?.message ?? e}` };
  }
}
