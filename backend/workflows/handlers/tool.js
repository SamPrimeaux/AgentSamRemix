import { dispatchByToolCode } from '../../http/agentsam/routes/dispatch-by-tool-code.js';
import { flattenWorkflowInput, parseNodeInputSchema } from './common.js';
import { resolveWorkflowToolParams } from '../runtime/tool-params.js';

function toolContext(runContext = {}) {
  const meta = runContext.runMeta || {};
  return {
    ...runContext,
    workspaceId: meta.workspaceId ?? runContext.workspaceId ?? null,
    tenantId: meta.tenantId ?? runContext.tenantId ?? null,
    userId: runContext.canonicalUserId ?? meta.userId ?? runContext.userId ?? null,
  };
}

export async function executeWorkflowTool(env, toolKey, input, runContext, config = {}) {
  if (runContext?.smoke) return { ok: true, output: { smoke: true, skipped: true, tool_key: toolKey } };
  const params = resolveWorkflowToolParams(config, flattenWorkflowInput(input));
  const out = await dispatchByToolCode(env, toolKey, params, toolContext(runContext));
  if (out?.ok === false) return { ok: false, error: String(out.error || 'dispatch_failed') };
  return { ok: true, output: out.result ?? out };
}

export async function executeWorkflowTerminalTool(env, handlerKey, input, runContext, node, config = {}) {
  if (runContext?.smoke) return { ok: true, output: { smoke: true, skipped: true, handler_key: handlerKey } };
  const flat = flattenWorkflowInput(input);
  const schema = parseNodeInputSchema(node);
  let agentCommand = '';
  if (typeof flat.result === 'string') {
    try {
      const parsed = JSON.parse(flat.result);
      agentCommand = parsed?.command || parsed?.cmd || parsed?.wrangler_command || '';
    } catch {}
  }
  const command = String(
    config.command ?? config.cmd ?? flat.command ?? flat.cmd ?? flat.default_command ?? agentCommand ?? schema.default_command ?? '',
  ).trim();
  const configuredToolKey = String(config.tool_key || config.tool_code || '').trim();
  const toolKey = !configuredToolKey || configuredToolKey === 'terminal_run' || configuredToolKey === 'terminal_execute'
    ? 'agentsam_terminal_local'
    : configuredToolKey;
  const params = { ...flat, ...(command ? { command } : {}) };
  return executeWorkflowTool(env, toolKey, params, runContext, {});
}
