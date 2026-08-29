import { parseWorkflowMetadata } from '../contracts/execution-strategy.js';

export function isWorkflowSignedOff(workflowRow) {
  const meta = parseWorkflowMetadata(workflowRow?.metadata_json);
  if (meta.signed_off === true) return true;
  const mode = String(meta.automation_mode || '').trim().toLowerCase();
  return mode === 'trusted' || mode === 'signed_off';
}

export function shouldEnforceWorkflowApproval(workflowRow) {
  return !isWorkflowSignedOff(workflowRow);
}

export function mergeWorkflowMetadata(existingRaw, patchRaw) {
  return { ...parseWorkflowMetadata(existingRaw), ...parseWorkflowMetadata(patchRaw) };
}

export function buildSignedOffMetadataPatch(existingRaw, { signedOff, userId } = {}) {
  return mergeWorkflowMetadata(existingRaw, {
    signed_off: signedOff === true,
    ...(signedOff
      ? { signed_off_at: new Date().toISOString(), ...(userId ? { signed_off_by: String(userId) } : {}) }
      : { signed_off_at: null, signed_off_by: null }),
  });
}
