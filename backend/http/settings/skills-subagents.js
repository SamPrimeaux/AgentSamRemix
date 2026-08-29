/**
 * Settings transport for Agent Sam skills, subagents, commands, and rules.
 * Identity is resolved once before this handler; domain behavior lives under backend/agentsam/.
 */
import {
  createSkillForSettings,
  listSkillsForSettings,
  patchSkillForSettings,
} from '../../agentsam/skills/settings.js';
import {
  createSubagentForSettings,
  deleteSubagentForSettings,
  listSubagentsForSettings,
  patchSubagentForSettings,
} from '../../agentsam/subagents/settings.js';
import {
  listCommandsForSettings,
  toggleCommandForSettings,
} from '../../agentsam/catalog/commands.js';
import {
  createRuleForSettings,
  deleteRuleForSettings,
  listRulesForSettings,
  patchRuleForSettings,
} from '../../agentsam/rules/settings.js';

const ERROR_STATUS = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
  internal: 500,
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function respond(result) {
  if (result?.ok) return jsonResponse(result.body ?? { ok: true });
  return jsonResponse(
    { error: result?.error || 'settings_request_failed' },
    ERROR_STATUS[result?.kind] || 500,
  );
}

async function requestBody(request) {
  return request.json().catch(() => ({}));
}

function decodeRouteId(match) {
  return decodeURIComponent(match?.[1] || '').trim();
}

export async function handleSettingsSkillsSubagentsRoutes(request, env, ctx, authContext) {
  void ctx;
  const { identity, pathLower, method } = authContext || {};
  const userId = identity?.user?.id != null ? String(identity.user.id).trim() : '';
  if (!userId) return null;

  const scope = {
    userId,
    tenantId: identity?.tenant?.id ?? null,
    workspaceId: identity?.workspace?.id ?? null,
  };

  if (pathLower === '/api/settings/skills') {
    if (method === 'GET') return respond(await listSkillsForSettings(env, scope));
    if (method === 'POST') return respond(await createSkillForSettings(env, scope, await requestBody(request)));
  }
  let match = pathLower.match(/^\/api\/settings\/skills\/([^/]+)$/);
  if (match && method === 'PATCH') {
    return respond(await patchSkillForSettings(env, scope, decodeRouteId(match), await requestBody(request)));
  }

  if (pathLower === '/api/settings/subagents') {
    if (method === 'GET') return respond(await listSubagentsForSettings(env, scope));
    if (method === 'POST') return respond(await createSubagentForSettings(env, scope, await requestBody(request)));
  }
  match = pathLower.match(/^\/api\/settings\/subagents\/([^/]+)$/);
  if (match && method === 'PATCH') {
    return respond(await patchSubagentForSettings(env, scope, decodeRouteId(match), await requestBody(request)));
  }
  if (match && method === 'DELETE') {
    return respond(await deleteSubagentForSettings(env, scope, decodeRouteId(match)));
  }

  if (pathLower === '/api/settings/commands' && method === 'GET') {
    return respond(await listCommandsForSettings(env, scope));
  }
  match = pathLower.match(/^\/api\/settings\/commands\/([^/]+)\/toggle$/);
  if (match && method === 'PATCH') {
    return respond(await toggleCommandForSettings(env, decodeRouteId(match), await requestBody(request)));
  }

  if (pathLower === '/api/settings/rules') {
    if (method === 'GET') return respond(await listRulesForSettings(env, scope));
    if (method === 'POST') return respond(await createRuleForSettings(env, scope, await requestBody(request)));
  }
  match = pathLower.match(/^\/api\/settings\/rules\/([^/]+)$/);
  if (match && method === 'PATCH') {
    return respond(await patchRuleForSettings(env, scope, decodeRouteId(match), await requestBody(request)));
  }
  if (match && method === 'DELETE') {
    return respond(await deleteRuleForSettings(env, scope, decodeRouteId(match)));
  }

  return null;
}
