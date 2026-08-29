export function flattenWorkflowInput(input) {
  if (input == null) return {};
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ...parsed, result: input };
    } catch {}
    return { result: input, message: input };
  }
  if (typeof input !== 'object' || Array.isArray(input)) return { value: input };
  const out = { ...input };
  if (out.output && typeof out.output === 'object' && !Array.isArray(out.output)) Object.assign(out, out.output);
  if (typeof out.result === 'string') {
    try {
      const parsed = JSON.parse(out.result);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(out, parsed);
    } catch {}
  }
  return out;
}

export function safeJsonObject(raw, fallback = {}) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...fallback, ...raw };
  try {
    const parsed = JSON.parse(String(raw || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...fallback, ...parsed } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

export function parseNodeConfig(node) {
  return safeJsonObject(
    node?.handler_config_json ?? node?.handler_config ?? node?.config_json ?? node?.input_schema_json ?? '{}',
  );
}

export function parseNodeInputSchema(node) {
  return safeJsonObject(node?.input_schema_json ?? '{}');
}

export function getByPath(obj, path) {
  const parts = String(path || '').replace(/^\$\.?/, '').split('.').filter(Boolean);
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

export function workflowHandlerContext(runContext = {}, node = null) {
  const meta = runContext.runMeta || {};
  return {
    tenantId: meta.tenantId ?? runContext.tenantId ?? null,
    workspaceId: meta.workspaceId ?? runContext.workspaceId ?? null,
    userId: meta.userId ?? runContext.canonicalUserId ?? runContext.userId ?? null,
    runId: runContext.runId ?? runContext.workflowRunId ?? null,
    workflowKey: runContext.workflowKey ?? null,
    nodeKey: node?.node_key ?? null,
    smoke: Boolean(runContext.smoke),
  };
}

export function buildWorkflowParamRoot(input, runContext = {}) {
  const flat = flattenWorkflowInput(input);
  const meta = runContext.runMeta || {};
  const runId = runContext.runId ?? runContext.workflowRunId ?? null;
  return {
    ...flat,
    run_id: runId,
    workflow_run_id: runId,
    workflow_id: runContext.workflowId ?? runContext.workflowMeta?.id ?? null,
    workflow_key: runContext.workflowKey ?? null,
    workspace_id: meta.workspaceId ?? flat.workspace_id ?? null,
    tenant_id: meta.tenantId ?? flat.tenant_id ?? null,
    user_id: meta.userId ?? runContext.canonicalUserId ?? flat.user_id ?? null,
    input: flat,
    run: runId ? { id: runId } : {},
  };
}

export function normalizeNodeOutput(nodeOutput) {
  if (nodeOutput == null || typeof nodeOutput !== 'object') return nodeOutput;
  if (nodeOutput.output != null) return nodeOutput;
  if (nodeOutput.result == null) return nodeOutput;
  return { ...nodeOutput, output: nodeOutput.result };
}
