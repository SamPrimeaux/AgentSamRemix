/** Workflow execution strategy. Transport (SSE/JSON/service binding) is separate. */

export function parseWorkflowMetadata(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  try {
    const o = JSON.parse(String(raw || '{}'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

export function normalizeWorkflowExecutionStrategy(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'durable' || v === 'cf' || v === 'workflows' || v === 'cloudflare') return 'durable';
  // Legacy boundary only: old metadata called the inline engine "sse".
  if (v === 'sse' || v === 'inline' || v === 'in_worker' || v === 'worker') return 'inline';
  if (v === 'auto' || v === 'smart') return 'auto';
  return 'inline';
}

function isSignedOff(workflowRow) {
  const meta = parseWorkflowMetadata(workflowRow?.metadata_json);
  if (meta.signed_off === true) return true;
  const mode = String(meta.automation_mode || '').trim().toLowerCase();
  return mode === 'trusted' || mode === 'signed_off';
}

function autoPick(workflowRow, opts = {}) {
  const nodeCount = Number(opts.nodeCount) || 0;
  const requiresApproval =
    opts.requiresApproval != null
      ? opts.requiresApproval === true
      : Number(workflowRow?.requires_approval) === 1; // current-production compatibility until canonical migration lands
  if (isSignedOff(workflowRow)) return nodeCount > 10 ? 'durable' : 'inline';
  const risk = String(workflowRow?.risk_level || 'low').toLowerCase();
  if (requiresApproval || risk === 'high' || risk === 'critical' || nodeCount > 10) return 'durable';
  return 'inline';
}

export function resolveWorkflowExecutionStrategy(workflowRow, opts = {}) {
  const overrideRaw = opts.override != null ? String(opts.override).trim() : '';
  if (overrideRaw) {
    const normalized = normalizeWorkflowExecutionStrategy(overrideRaw);
    return normalized === 'auto' ? autoPick(workflowRow, opts) : normalized;
  }

  const meta = parseWorkflowMetadata(workflowRow?.metadata_json);
  const explicit = meta.execution_strategy ?? meta.executionStrategy ?? meta.execution_engine ?? meta.executionEngine ?? null;
  if (!explicit) return 'inline';
  const strategy = normalizeWorkflowExecutionStrategy(explicit);
  return strategy === 'auto' ? autoPick(workflowRow, opts) : strategy;
}
