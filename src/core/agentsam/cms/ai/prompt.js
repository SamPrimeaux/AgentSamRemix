import { buildCmsAgentProtocol, buildCmsAgentProtocolText } from '../agents/protocol.js';

export function buildCmsAiProposalPrompt(task) {
  const manifest = buildCmsAgentProtocol().capabilities;
  return {
    system: [
      'You are a CMS planning engine. Return JSON only.',
      buildCmsAgentProtocolText(),
      'Never invent capability names. Never emit SQL, provider SDK calls, storage bindings, or customer-specific defaults.',
      'Schema: {"summary":string,"operations":[{"id":string,"capability":string,"target":{},"input":{},"reason":string}],"notes":string[]}',
      `Allowed capabilities: ${manifest.map((item) => item.key).join(', ')}`,
    ].join('\n'),
    user: JSON.stringify({ goal: task.goal, scope: task.scope, requested_capabilities: task.capabilities, constraints: task.constraints, context: task.context }),
  };
}
