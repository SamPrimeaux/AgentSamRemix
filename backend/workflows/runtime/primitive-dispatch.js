import { resolveHandler } from '../repository/handlers.js';
import { executeWorkflowAgent } from '../handlers/agent.js';
import { executeWorkflowApproval } from '../handlers/approval.js';
import { executeWorkflowBranch } from '../handlers/branch.js';
import { executeWorkflowDbQuery } from '../handlers/db.js';
import { executeWorkflowEval } from '../handlers/eval.js';
import { executeWorkflowHttp } from '../handlers/http.js';
import { executeWorkflowScript } from '../handlers/script.js';
import { executeWorkflowTerminalTool, executeWorkflowTool } from '../handlers/tool.js';
import { buildWorkflowParamRoot, flattenWorkflowInput, getByPath } from '../handlers/common.js';

async function executeSqlPrimitive(env, config, input, runContext) {
  const sql = String(config.sql || '').trim();
  if (!sql) return null;
  const root = buildWorkflowParamRoot(input, runContext);
  const params = (config.params || []).map((value) =>
    typeof value === 'string' && value.startsWith('$.') ? getByPath(root, value) : value,
  );
  if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) {
    const result = await env.DB.prepare(sql).bind(...params).run();
    return { ok: true, output: { changes: result?.meta?.changes ?? 0, rows: [] } };
  }
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return { ok: true, output: { rows: results || [], count: (results || []).length } };
}

export async function executeRegisteredWorkflowHandler(env, node, input, runContext) {
  const handlerKey = String(node?.handler_key || '').trim();
  if (!handlerKey) return null;
  const reg = await resolveHandler(env, handlerKey);
  if (!reg) return null;
  const nodeConfig = (() => {
    try { return JSON.parse(String(node?.handler_config_json || '{}')) || {}; } catch { return {}; }
  })();
  const config = { ...(reg.config || {}), ...nodeConfig };

  switch (reg.executor_kind) {
    case 'passthrough':
      return node?.node_type === 'branch'
        ? executeWorkflowBranch({ ...flattenWorkflowInput(runContext?.initialInput), ...flattenWorkflowInput(input) }, node)
        : { ok: true, output: input };
    case 'branch':
      return executeWorkflowBranch({ ...flattenWorkflowInput(runContext?.initialInput), ...flattenWorkflowInput(input) }, node);
    case 'd1_sql': {
      const direct = await executeSqlPrimitive(env, config, input, runContext);
      return direct ?? executeWorkflowDbQuery(env, handlerKey, input, runContext, node, config);
    }
    case 'agent_llm':
      return executeWorkflowAgent(env, handlerKey, input, runContext, node, config);
    case 'mcp_tool':
    case 'catalog_tool': {
      const toolKey = String(config.tool_key || config.tool_code || handlerKey).trim();
      return executeWorkflowTool(env, toolKey, input, runContext, config);
    }
    case 'agent_step': {
      const stepKey = String(config.handler_key || handlerKey).trim();
      const mod = await import('../handlers/named-steps.js');
      if (!mod.isRegisteredAgentStepHandler(stepKey)) return { ok: false, error: `agent_step not registered: ${stepKey}` };
      return mod.agentChatStep(env, { handler_key: stepKey, input, runContext, node, config });
    }
    case 'script':
      return executeWorkflowScript(env, handlerKey, input, runContext, node, config);
    case 'builtin_tool': {
      // Current-production compatibility only; never bypass the canonical catalog/tool path.
      if (config.delegate === 'script' || handlerKey.startsWith('script_')) {
        return executeWorkflowScript(env, handlerKey, input, runContext, node, config);
      }
      if (config.tool_key) return executeWorkflowTool(env, config.tool_key, input, runContext, config);
      const mod = await import('../handlers/named-steps.js');
      if (mod.isRegisteredAgentStepHandler(handlerKey)) return mod.agentChatStep(env, { handler_key: handlerKey, input, runContext, node, config });
      return { ok: false, error: `deprecated builtin_tool has no canonical target: ${handlerKey}` };
    }
    case 'ui_emit':
      // Some historical rows are actually HTTP telemetry. Preserve those as HTTP; presentation-only rows become inert.
      if (config.url || config.endpoint) return executeWorkflowHttp(env, handlerKey, input, runContext, node, config);
      return { ok: true, output: { deprecated_ui_emit: true, handler_key: handlerKey, event_type: config.event_type || null } };
    case 'eval':
      return executeWorkflowEval(env, handlerKey, input, runContext, node, config.quality_gate || config);
    case 'terminal':
      return executeWorkflowTerminalTool(env, handlerKey, input, runContext, node, config);
    case 'approval':
      return executeWorkflowApproval(env, handlerKey, input, runContext, node, config);
    case 'http':
      return executeWorkflowHttp(env, handlerKey, input, runContext, node, config);
    default:
      return { ok: false, error: `unknown executor_kind: ${reg.executor_kind} for handler: ${handlerKey}` };
  }
}
