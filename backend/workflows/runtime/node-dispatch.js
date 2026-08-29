import { executeRegisteredWorkflowHandler } from './primitive-dispatch.js';
import { executeWorkflowAgent } from '../handlers/agent.js';
import { executeWorkflowApproval } from '../handlers/approval.js';
import { executeWorkflowBranch } from '../handlers/branch.js';
import { executeWorkflowDbQuery } from '../handlers/db.js';
import { executeWorkflowEval } from '../handlers/eval.js';
import { executeWorkflowHttp } from '../handlers/http.js';
import { executeWorkflowScript } from '../handlers/script.js';
import { executeWorkflowTerminalTool, executeWorkflowTool } from '../handlers/tool.js';
import { flattenWorkflowInput, normalizeNodeOutput, parseNodeConfig } from '../handlers/common.js';

async function tryAgentStep(env, handlerKey, input, runContext, node) {
  if (!handlerKey) return null;
  const mod = await import('../handlers/named-steps.js');
  if (!mod.isRegisteredAgentStepHandler?.(handlerKey)) return null;
  return mod.agentChatStep(env, { handler_key: handlerKey, input, runContext, node, smoke: Boolean(runContext?.smoke) });
}

export async function dispatchWorkflowNode(env, node, input, runContext) {
  const handlerKey = String(node?.handler_key || '').trim();
  try {
    const registered = await executeRegisteredWorkflowHandler(env, node, input, runContext);
    if (registered) return normalizeNodeOutput(registered);
  } catch (e) {
    console.warn('[workflow] registered handler failed; falling back to node contract', handlerKey, e?.message ?? e);
  }

  const agentStep = await tryAgentStep(env, handlerKey, input, runContext).catch(() => null);
  if (agentStep) return normalizeNodeOutput(agentStep);

  const config = parseNodeConfig(node);
  let out;
  switch (String(node?.node_type || '').trim()) {
    case 'agent':
      out = await executeWorkflowAgent(env, handlerKey, input, runContext, node, config); break;
    case 'mcp_tool':
    case 'tool': {
      const candidates = [handlerKey, handlerKey.split('.').pop(), handlerKey.replace(/\./g, '_')].filter(Boolean);
      let last = { ok: false, error: `tool not found: ${handlerKey}` };
      for (const key of candidates) {
        last = await executeWorkflowTool(env, key, input, runContext, config);
        if (last.ok) break;
      }
      out = last; break;
    }
    case 'terminal':
      out = await executeWorkflowTerminalTool(env, handlerKey, input, runContext, node, config); break;
    case 'db_query':
      out = await executeWorkflowDbQuery(env, handlerKey, input, runContext, node, config); break;
    case 'script':
      out = await executeWorkflowScript(env, handlerKey, input, runContext, node, config); break;
    case 'eval':
      out = await executeWorkflowEval(env, handlerKey, input, runContext, node, config); break;
    case 'branch':
      out = await executeWorkflowBranch(input, node); break;
    case 'approval_gate':
      out = await executeWorkflowApproval(env, handlerKey, input, runContext, node, config); break;
    case 'webhook':
      if (config.url || config.endpoint) out = await executeWorkflowHttp(env, handlerKey, input, runContext, node, config);
      else if (handlerKey.startsWith('ui.') || handlerKey.startsWith('ui_')) out = { ok: true, output: { deprecated_ui_emit: true, handler_key: handlerKey } };
      else out = { ok: false, error: `webhook node missing endpoint: ${node?.node_key || handlerKey}` };
      break;
    case 'trigger':
      out = { ok: true, output: { triggered: true, payload: flattenWorkflowInput(input), node_key: node?.node_key } }; break;
    case 'process':
      out = { ok: true, output: { processed: true, ...flattenWorkflowInput(input), node_key: node?.node_key } }; break;
    case 'output':
      out = { ok: true, output: { final: flattenWorkflowInput(input), node_key: node?.node_key } }; break;
    case 'join':
      out = { ok: true, output: { joined: true, final: flattenWorkflowInput(input), node_key: node?.node_key } }; break;
    default:
      out = { ok: false, error: `unknown node_type: ${node?.node_type}` };
  }
  return normalizeNodeOutput(out);
}
