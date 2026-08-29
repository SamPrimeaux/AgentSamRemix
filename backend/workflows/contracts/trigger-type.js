export const WORKFLOW_TRIGGER_TYPES = Object.freeze([
  'manual',
  'agent',
  'agent_chat',
  'cursor',
  'github_push',
  'webhook',
  'scheduled',
  'cicd',
  'deploy',
  'api',
]);

export function normalizeWorkflowTriggerType(raw) {
  const triggerType = String(raw || 'agent').toLowerCase().trim() || 'agent';
  return WORKFLOW_TRIGGER_TYPES.includes(triggerType) ? triggerType : 'agent';
}
