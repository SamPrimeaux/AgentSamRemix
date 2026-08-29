import { warmAgentChunksForTab } from '../src/pwa/warmAgentChunks';

/**
 * Lazy chunk warm for code tab — /dashboard/agent/editor is the IDE workbench
 * (Workspace + side-rail chat; Monaco after a file opens).
 */
export function AgentEditorRoute() {
  return null;
}

warmAgentChunksForTab('code');

export default AgentEditorRoute;
