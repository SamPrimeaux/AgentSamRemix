import { flattenWorkflowInput, getByPath, parseNodeConfig, safeJsonObject } from './common.js';

export async function executeWorkflowBranch(input, node) {
  const flat = flattenWorkflowInput(input);
  let cfg = parseNodeConfig(node);
  const qg = safeJsonObject(node?.quality_gate_json);
  if (qg.branch_field) cfg = { ...cfg, ...qg };
  const field = String(cfg.branch_field || 'branch');
  const val = getByPath(flat, field) ?? flat[field];
  const branch = val != null && String(val).trim() !== ''
    ? String(val).trim()
    : flat.passed === false ? 'failed' : 'default';
  return { ok: true, output: { branch, field, value: val, passed: flat.passed !== false } };
}
