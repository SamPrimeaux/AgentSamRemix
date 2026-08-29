import { buildCmsCapabilityManifest } from '../contracts/capabilities.js';

export const CMS_AGENT_PROTOCOL_STEPS = Object.freeze([
  'Read the current CMS state before proposing mutations.',
  'Use Page → Section → Block vocabulary and canonical capability keys.',
  'Save draft mutations before publish.',
  'Publish only through the canonical lifecycle pipeline.',
  'Verify the published result after publish.',
]);

export function buildCmsAgentProtocol() {
  return {
    version: 1,
    model: 'Site → Page → Section → Block',
    steps: CMS_AGENT_PROTOCOL_STEPS,
    capabilities: buildCmsCapabilityManifest(),
  };
}

export function buildCmsAgentProtocolText() {
  return ['Canonical CMS agent loop:', ...CMS_AGENT_PROTOCOL_STEPS.map((step, index) => `${index + 1}. ${step}`)].join('\n');
}
