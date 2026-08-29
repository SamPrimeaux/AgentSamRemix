import { IAM_AGENT_CHAT_COMPOSE } from '../../agentChatConstants';

export function askAgentSam(message: string, send = true) {
  window.dispatchEvent(
    new CustomEvent(IAM_AGENT_CHAT_COMPOSE, {
      detail: { message, send, ensureAgentPanel: true },
    }),
  );
}
