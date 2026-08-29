/**
 * Projects API router — /api/projects*
 * Dispatched from src/api/finance.js after auth + DB checks.
 */
import { jsonResponse } from '../../core/auth.js';
import { handleOverview } from './overview.js';
import {
  handleList,
  handleClientProjectsList,
  handleGetOne,
  handlePost,
  handlePatch,
  handleDelete,
  handleProjectCostsGet,
  handleProjectCostsPost,
} from './crud.js';
import {
  handleProjectMemoryGet,
  handleProjectMemoryPatch,
  handleProjectContextAudit,
  handleProjectRuntimeContractSync,
  handleProjectCollaboratorsGet,
  handleProjectCollaboratorsPost,
  handleProjectCollaboratorDelete,
  handleProjectSharePost,
  handleProjectActivate,
  handleProjectWorkContext,
} from './collab.js';
import {
  handleProjectCodeIndexStatus,
  handleProjectGithubConnect,
  handleProjectReindex,
  handleProjectReindexCancel,
  handleProjectReindexResume,
  handleProjectBackfillCalls,
} from './code-index.js';
import { handleDeployActivity } from './deploy-activity.js';
import { resolveIdentity } from '../../../backend/identity/index.js';

export async function handleProjectsApi(request, url, env, authUser, ctx = null) {
  const pathLower = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const sub = pathLower.startsWith('/api/projects/') ? pathLower.slice('/api/projects/'.length) : '';
  const identity = await resolveIdentity(request, env);
  const workspaceId = identity.workspace?.id || null;

  if (pathLower === '/api/projects/deploy-activity' && method === 'GET') {
    return handleDeployActivity(env, authUser, url, workspaceId);
  }

  if (pathLower === '/api/projects/context-audit' && method === 'GET') {
    return handleProjectContextAudit(env, authUser, url, workspaceId);
  }

  if (pathLower === '/api/projects/overview' && method === 'GET') {
    return handleOverview(request, url, env, authUser, workspaceId);
  }

  if (pathLower === '/api/projects' && method === 'GET') {
    return handleList(request, env, authUser, url, workspaceId);
  }

  if (pathLower === '/api/projects/clients' && method === 'GET') {
    return handleClientProjectsList(env, authUser);
  }

  if (pathLower === '/api/projects' && method === 'POST') {
    return handlePost(request, env, authUser, ctx);
  }

  const seg = sub.split('/').filter(Boolean);
  if (seg.length === 2 && seg[1] === 'activate' && method === 'POST') {
    return handleProjectActivate(request, env, authUser, seg[0], ctx);
  }
  if (seg.length === 2 && seg[1] === 'work-context' && method === 'GET') {
    return handleProjectWorkContext(env, authUser, seg[0]);
  }
  if (seg.length === 2 && seg[1] === 'code-index-status' && method === 'GET') {
    return handleProjectCodeIndexStatus(request, env, authUser, seg[0], ctx);
  }
  if (seg.length === 2 && seg[1] === 'reindex' && method === 'POST') {
    return handleProjectReindex(request, env, authUser, seg[0], ctx);
  }
  if (seg.length === 3 && seg[1] === 'reindex' && seg[2] === 'cancel' && method === 'POST') {
    return handleProjectReindexCancel(request, env, authUser, seg[0]);
  }
  if (seg.length === 3 && seg[1] === 'reindex' && seg[2] === 'resume' && method === 'POST') {
    return handleProjectReindexResume(request, env, authUser, seg[0], ctx);
  }
  if (seg.length === 3 && seg[1] === 'reindex' && seg[2] === 'calls' && method === 'POST') {
    return handleProjectBackfillCalls(request, env, authUser, seg[0], ctx);
  }
  if (seg.length === 2 && seg[1] === 'github' && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    return handleProjectGithubConnect(request, env, authUser, seg[0], ctx);
  }
  if (seg.length === 2 && seg[1] === 'github' && method === 'DELETE') {
    const clearReq = new Request(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clear: true, start_index: false }),
    });
    return handleProjectGithubConnect(clearReq, env, authUser, seg[0], ctx);
  }
  if (seg.length === 2 && seg[1] === 'memory') {
    if (method === 'GET') return handleProjectMemoryGet(env, authUser, seg[0]);
    if (method === 'PATCH' || method === 'PUT') return handleProjectMemoryPatch(request, env, authUser, seg[0]);
  }
  if (seg.length === 3 && seg[1] === 'runtime-contract' && seg[2] === 'sync') {
    if (method === 'POST') return handleProjectRuntimeContractSync(request, env, authUser, seg[0]);
  }
  if (seg.length === 2 && seg[1] === 'collaborators') {
    if (method === 'GET') return handleProjectCollaboratorsGet(env, authUser, seg[0]);
    if (method === 'POST') return handleProjectCollaboratorsPost(request, env, authUser, seg[0]);
  }
  if (seg.length === 3 && seg[1] === 'collaborators' && method === 'DELETE') {
    return handleProjectCollaboratorDelete(env, authUser, seg[0], seg[2]);
  }
  if (seg.length === 2 && seg[1] === 'share' && method === 'POST') {
    return handleProjectSharePost(request, env, authUser, seg[0]);
  }
  if (seg.length === 2 && seg[1] === 'costs') {
    if (method === 'GET') return handleProjectCostsGet(env, authUser, seg[0]);
    if (method === 'POST') return handleProjectCostsPost(request, env, authUser, seg[0]);
  }
  if (seg.length === 1 && method === 'GET') {
    return handleGetOne(env, authUser, seg[0]);
  }
  if (seg.length === 1 && (method === 'PATCH' || method === 'PUT')) {
    return handlePatch(request, env, authUser, seg[0], ctx);
  }
  if (seg.length === 1 && method === 'DELETE') {
    return handleDelete(request, env, authUser, seg[0], url, ctx);
  }

  return jsonResponse({ ok: false, error: 'projects_route_not_found' }, 404);
}
