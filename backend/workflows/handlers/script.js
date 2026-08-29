import { parseNodeConfig } from './common.js';

export async function executeWorkflowScript(env, handlerKey, input, runContext, node, config = null) {
  const cfg = config && typeof config === 'object' && Object.keys(config).length ? config : parseNodeConfig(node);
  const scriptSlug = String(cfg.script_slug || cfg.scriptSlug || '').trim();
  if (!scriptSlug) return { ok: false, error: `script node requires script_slug (handler_key=${handlerKey || node?.node_key || 'unknown'})` };
  const { executeAgentsamScript } = await import('../../../src/core/execute-agentsam-script.js');
  return executeAgentsamScript(env, {
    scriptSlug,
    workspaceId: runContext?.runMeta?.workspaceId ?? runContext?.workspaceId,
    tenantId: runContext?.runMeta?.tenantId ?? runContext?.tenantId,
    userId: runContext?.runMeta?.userId ?? runContext?.userId,
    smoke: runContext?.smoke,
  }, input, runContext);
}
