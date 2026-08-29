import { handleInternalChatSessionPurge } from './chat-session-purge.js';
import { handleInternalErrorLogRoute } from './error-log.js';
import { handleInternalExecContextRoute } from './exec-context.js';
import { handleInternalTerminalSandboxRoute } from './terminal-sandbox.js';
import { handleInternalActorAuthorityHttp } from './actor-authority.js';
import { handleInternalHealthKvDirty } from './health-kv-dirty.js';

export async function dispatchInternalHttpRoutes({ request, env, ctx, pathLower }) {
  if (pathLower === '/api/internal/chat-sessions/purge-archived') return handleInternalChatSessionPurge(request, env);
  if (pathLower === '/api/internal/error-log') return handleInternalErrorLogRoute(request, env, ctx);
  if (pathLower === '/api/internal/exec/context/snapshot') return handleInternalExecContextRoute(request, env);
  if (pathLower === '/api/internal/terminal/sandbox/exec') return handleInternalTerminalSandboxRoute(request, env);
  if (pathLower === '/api/internal/actor-authority/resolve' && request.method.toUpperCase() === 'POST') return handleInternalActorAuthorityHttp(request, env);
  if (pathLower === '/api/internal/health-kv-dirty') return handleInternalHealthKvDirty(request, env);
  return null;
}
