/** Runtime continuation state is intentionally separate from compact persistence journals. */
export function nextWorkflowRuntimeValue(nodeOutput, fallback = null) {
  if (!nodeOutput || typeof nodeOutput !== 'object') return fallback;
  return nodeOutput.output !== undefined ? nodeOutput.output : fallback;
}

export function buildApprovalContinuation({ gateNodeKey, nodeInput, gateOutput, approvalId }) {
  return {
    version: 1,
    gate_node_key: String(gateNodeKey || ''),
    value: nodeInput ?? null,
    gate_output: gateOutput ?? null,
    approval_id: approvalId ?? null,
  };
}

export function resumeApprovalContinuation(continuation, decision = 'approved') {
  const base = continuation?.value;
  const value = base && typeof base === 'object' && !Array.isArray(base)
    ? { ...base, status: decision }
    : { value: base ?? null, status: decision };
  return {
    gateNodeKey: String(continuation?.gate_node_key || ''),
    value,
    edgeOutput: { ok: decision === 'approved', output: value },
  };
}
