/**
 * Platform adapter for canonical CMS AI contracts.
 * Provider/model choice stays in the Agent Sam catalog/router; CMS core never imports provider SDKs.
 */
import { createCmsAgentService } from './agentsam/cms/agents/index.js';
import { createCmsAiService } from './agentsam/cms/ai/index.js';
import { resolveModelForTask } from '../../backend/agentsam/runtime/routing/resolve-model-for-task.js';
import { dispatchComplete } from '../../backend/agentsam/runtime/provider-dispatch.js';

export function extractCmsProviderText(result) {
  if (typeof result === 'string') return result;
  if (typeof result?.text === 'string') return result.text;
  if (typeof result?.output_text === 'string') return result.output_text;
  if (typeof result?.content?.[0]?.text === 'string') return result.content[0].text;
  if (typeof result?.message?.content === 'string') return result.message.content;
  if (typeof result?.output === 'string') return result.output;
  return result;
}

export function createPlatformCmsAiProvider(env, scope = {}) {
  return Object.freeze({
    async complete(request = {}) {
      const requestedModelKey = String(request.requested_model_key || '').trim() || null;
      const resolved = await resolveModelForTask(env, {
        mode: 'agent',
        route_key: 'planning',
        requested_model_key: requestedModelKey,
        workspace_id: scope.workspace_id || scope.workspaceId || null,
        tenant_id: scope.tenant_id || scope.tenantId || null,
        require_tools: false,
        require_json_mode: false,
      });
      if (!resolved?.model_key) throw new Error('cms_ai_model_unresolved');
      const result = await dispatchComplete(env, {
        modelKey: resolved.model_key,
        taskType: 'plan',
        systemPrompt: String(request.system || ''),
        messages: Array.isArray(request.messages) ? request.messages : [],
        userId: scope.user_id || scope.userId || null,
        options: { reasoningEffort: 'medium', verbosity: 'low' },
      });
      return {
        text: extractCmsProviderText(result),
        model: {
          model_key: resolved.model_key,
          provider: resolved.provider || null,
          api_platform: resolved.api_platform || null,
        },
      };
    },
  });
}

export async function generateCmsAgentProposal(env, input = {}, scope = {}) {
  const ai = createCmsAiService(createPlatformCmsAiProvider(env, scope));
  const agent = createCmsAgentService({ ai });
  return agent.propose(input);
}

export async function resolveCmsHandoffModelKey(env, scope = {}) {
  const requestedModelKey = String(scope.requested_model_key || scope.requestedModelKey || '').trim() || null;
  const resolved = await resolveModelForTask(env, {
    mode: 'agent',
    requested_model_key: requestedModelKey,
    workspace_id: scope.workspace_id || scope.workspaceId || null,
    tenant_id: scope.tenant_id || scope.tenantId || null,
    require_tools: true,
  });
  if (!resolved?.model_key) throw new Error('cms_handoff_model_unresolved');
  return resolved.model_key;
}
