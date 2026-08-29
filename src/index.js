import './core/worker-unhandled-rejection.js';
import '../backend/identity/worker-boot.js';
import { handleWorkerFetch } from '../backend/worker/index.js';
import { handleWorkerScheduled } from '../backend/worker/scheduled.js';
import { handleWorkerQueue } from '../backend/worker/queue.js';
import { handleLegacyWorkerFallback } from '../legacy/worker.js';

// Temporary Wrangler-owned Durable Object exports. These leave src/ as each
// authority is physically moved under backend/.
export { IAMCollaborationSession } from './do/Collaboration.js';
export { AgentChatSqlV1 } from './do/AgentChat.js';
export { AgentBrowserLiveV1 } from './do/AgentBrowserLive.js';
export { OpenAiResponsesWsV1 } from './do/OpenAiResponsesWs.js';
export { ChessRoom } from './do/ChessRoom.js';
export { MyContainer } from './do/MyContainer.js';
export { IamCadWorkerContainer } from './do/IamCadWorkerContainer.js';
export { CodemodeRuntime } from '@cloudflare/codemode';
export { ContainerProxy } from '@cloudflare/containers';

export default {
  fetch(request, env, ctx) {
    return handleWorkerFetch(request, env, ctx, { fallback: handleLegacyWorkerFallback });
  },
  scheduled: handleWorkerScheduled,
  queue: handleWorkerQueue,
};
