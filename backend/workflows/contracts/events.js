export const WORKFLOW_EVENT_TYPES = Object.freeze([
  'run_started',
  'node_started',
  'node_completed',
  'node_failed',
  'approval_required',
  'edge_selected',
  'run_completed',
  'run_failed',
]);

export function emitWorkflowEvent(emit, type, payload = {}) {
  if (typeof emit !== 'function') return;
  if (!WORKFLOW_EVENT_TYPES.includes(type)) {
    throw new Error(`unknown_workflow_event:${type}`);
  }
  emit({ type, ...payload });
}
