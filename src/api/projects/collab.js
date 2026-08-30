/**
 * Projects API — peeled from monolithic projects.js (mechanical).
 */
import { jsonResponse } from '../../core/responses.js'; import { verifyBridgeKey } from '../../../backend/auth/bridge-key-auth.js'; import { syncSessionWorkspaceId } from '../../../backend/identity/index.js';
import { userCanAccessWorkspace } from '../../core/workspace-access.js';
import { withD1Retry } from '../../core/d1-retry.js';
import {
  readProjectDashboardMemory,
  upsertProjectDashboardMemory,
} from '../../core/project-dashboard-memory.js';
import { syncProjectRuntimeContract } from '../../core/project-runtime-contract-sync.js';
import { buildProjectContextAudit } from '../../core/project-context-audit.js';
import { sendResendEmail } from '../../../backend/services/email/resend.js';
import {
  resolveProjectGithubRepo,
  setProjectGithubRepo,
  readProjectGithubRepoFromRow,
  normalizeGithubRepoFullName,
} from '../../../backend/agentsam/codebase/project-github-repo.js';
import { resolveWorkspaceBindings, normalizeWorkspaceBindings, healProjectWorkspaceId } from '../../../backend/identity/workspace/agentsam-workspace.js';
import { scheduleSyncProjectToSupabase } from '../../core/agentsam-projects-supabase-sync.js';
import { resolveSupabaseWorkspaceId } from '../../../backend/rag/index.js';
import {
  parseMetadataObject,
  assertProjectAccess,
  claimProjectCollaborator,
  buildProjectWhereClause,
} from './helpers.js';
import { resolveProjectExecutionWorkspace } from './code-index.js';
import { PRODUCT_SOURCE_TYPE_SQL_IN } from '../../../backend/agentsam/codebase/codebase-full-index.js';

export async function handleProjectMemoryGet(env, authUser, projectId) {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first();
  const access = await assertProjectAccess(env, authUser, row);
  if (!access.ok) return jsonResponse({ ok: false, error: access.error }, access.status);

  const mem = await readProjectDashboardMemory(env.DB, projectId);
  return jsonResponse({ ok: true, project_id: String(projectId), ...mem });
}

export async function handleProjectMemoryPatch(request, env, authUser, projectId) {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first();
  const access = await assertProjectAccess(env, authUser, row);
  if (!access.ok) return jsonResponse({ ok: false, error: access.error }, access.status);

  const body = await request.json().catch(() => ({}));
  const tenantId = row.tenant_id ? String(row.tenant_id) : authUser.tenant_id ? String(authUser.tenant_id) : '';
  if (!tenantId) return jsonResponse({ ok: false, error: 'tenant_required' }, 400);

  try {
    const next = await upsertProjectDashboardMemory(env.DB, {
      projectId: String(projectId),
      tenantId,
      userId: authUser?.id ?? null,
      memory: Object.prototype.hasOwnProperty.call(body, 'memory') ? String(body.memory ?? '') : undefined,
      instructions: Object.prototype.hasOwnProperty.call(body, 'instructions')
        ? String(body.instructions ?? '')
        : undefined,
    });
    return jsonResponse({ ok: true, project_id: String(projectId), ...next });
  } catch (e) {
    return jsonResponse({ ok: false, error: `memory_update_failed: ${e?.message || e}` }, 500);
  }
}

export async function handleProjectContextAudit(env, authUser, url, workspaceId) {
  const tenantId = authUser.tenant_id ? String(authUser.tenant_id) : null;
  const scope = String(url.searchParams.get('scope') || 'tenant').trim().toLowerCase();
  const includeArchived =
    url.searchParams.get('include_archived') === '1' ||
    url.searchParams.get('include_archived') === 'true';

  let whereSql;
  let whereBinds;
  if (scope === 'tenant' && tenantId) {
    whereSql = 'p.tenant_id = ?';
    whereBinds = [tenantId];
  } else {
    ({ sql: whereSql, binds: whereBinds } = buildProjectWhereClause(workspaceId, tenantId));
  }
  if (!includeArchived) {
    whereSql += ` AND COALESCE(p.status, '') != 'archived'`;
  }

  const { results } = await withD1Retry(() =>
    env.DB.prepare(
      `SELECT p.id, p.name, p.status, p.project_type, p.workspace_id, p.client_id, p.worker_id, p.domain, p.tenant_id
       FROM projects p
       WHERE ${whereSql}
       ORDER BY p.name ASC`,
    )
      .bind(...whereBinds)
      .all(),
  );

  const mergedRows = mergeProjectRowsById(results || [], await fetchCollaboratorProjectRows(env, authUser));
  const audit = await buildProjectContextAudit(env, { projectRows: mergedRows });
  return projectsJsonResponse(
    { ok: true, projects: audit, total: audit.length },
    200,
    'private, no-store',
  );
}

export async function handleProjectRuntimeContractSync(request, env, authUser, projectId) {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first();
  if (!row) return jsonResponse({ ok: false, error: 'not_found' }, 404);

  const bridgeSync = verifyBridgeKey(request, env);
  if (!bridgeSync) {
    if (!authUser?.id) {
      return jsonResponse({ ok: false, error: 'Unauthorized', code: 'SESSION_MISSING' }, 401);
    }
    const access = await assertProjectAccess(env, authUser, row);
    if (!access.ok) return jsonResponse({ ok: false, error: access.error }, access.status);
  }

  const body = await request.json().catch(() => ({}));
  const agentsamMarkdown =
    typeof body.agentsam_markdown === 'string'
      ? body.agentsam_markdown
      : typeof body.agentsamMarkdown === 'string'
        ? body.agentsamMarkdown
        : null;

  try {
    const result = await syncProjectRuntimeContract(env, {
      projectRef: String(projectId),
      workspaceId: row.workspace_id ? String(row.workspace_id) : null,
      tenantId: row.tenant_id ? String(row.tenant_id) : authUser.tenant_id ? String(authUser.tenant_id) : null,
      userId: authUser?.id ?? null,
      agentsamMarkdown,
      force: body.force === true,
    });
    const status = result.ok ? 200 : result.error === 'migration_800_required' ? 503 : 400;
    return jsonResponse({ ok: result.ok, project_id: String(projectId), ...result }, status);
  } catch (e) {
    return jsonResponse({ ok: false, error: `runtime_contract_sync_failed: ${e?.message || e}` }, 500);
  }
}

export async function handleProjectCollaboratorsGet(env, authUser, projectId) {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first();
  const access = await assertProjectAccess(env, authUser, row);
  if (!access.ok) return jsonResponse({ ok: false, error: access.error }, access.status);

  try {
    const { results } = await env.DB
      .prepare(
        `SELECT id, project_id, email, user_id, role, invited_by, workspace_id, created_at, updated_at
         FROM project_collaborators WHERE project_id = ? ORDER BY created_at ASC`,
      )
      .bind(String(projectId))
      .all();
    return jsonResponse({ ok: true, project_id: String(projectId), collaborators: results || [] });
  } catch (e) {
    return jsonResponse({ ok: false, error: `collaborators_read_failed: ${e?.message || e}` }, 500);
  }
}

export async function handleProjectCollaboratorsPost(request, env, authUser, projectId) {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first();
  const access = await assertProjectAccess(env, authUser, row);
  if (!access.ok) return jsonResponse({ ok: false, error: access.error }, access.status);

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return jsonResponse({ ok: false, error: 'valid_email_required' }, 400);
  const role = String(body.role || 'editor').trim().toLowerCase() === 'viewer' ? 'viewer' : 'editor';
  const tenantId = row.tenant_id ? String(row.tenant_id) : String(authUser.tenant_id || '');
  const collabId = `pcol_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

  try {
    await env.DB
      .prepare(
        `INSERT INTO project_collaborators (
          id, project_id, tenant_id, workspace_id, email, user_id, role, invited_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, unixepoch(), unixepoch())
        ON CONFLICT(project_id, email) DO UPDATE SET
          role = excluded.role,
          updated_at = unixepoch(),
          invited_by = excluded.invited_by`,
      )
      .bind(
        collabId,
        String(projectId),
        tenantId,
        row.workspace_id ? String(row.workspace_id) : null,
        email,
        role,
        authUser?.id != null ? String(authUser.id) : null,
      )
      .run();
  } catch (e) {
    return jsonResponse({ ok: false, error: `collaborator_upsert_failed: ${e?.message || e}` }, 500);
  }

  const collabRes = await handleProjectCollaboratorsGet(env, authUser, projectId);
  const collabJson = await collabRes.json();

  return jsonResponse(
    {
      ok: true,
      collaborator: collabJson.collaborators?.find((c) => String(c.email).toLowerCase() === email) ?? null,
      collaborators: collabJson.collaborators ?? [],
    },
    201,
  );
}

export async function handleProjectCollaboratorDelete(env, authUser, projectId, collabId) {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first();
  const access = await assertProjectAccess(env, authUser, row);
  if (!access.ok) return jsonResponse({ ok: false, error: access.error }, access.status);

  try {
    await env.DB
      .prepare(`DELETE FROM project_collaborators WHERE id = ? AND project_id = ?`)
      .bind(String(collabId), String(projectId))
      .run();
  } catch (e) {
    return jsonResponse({ ok: false, error: `collaborator_delete_failed: ${e?.message || e}` }, 500);
  }
  return jsonResponse({ ok: true, deleted: true, id: collabId });
}

export async function handleProjectSharePost(request, env, authUser, projectId) {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first();
  const access = await assertProjectAccess(env, authUser, row);
  if (!access.ok) return jsonResponse({ ok: false, error: access.error }, access.status);

  const body = await request.json().catch(() => ({}));
  const base =
    (env.PUBLIC_APP_URL && String(env.PUBLIC_APP_URL).trim()) ||
    (env.ASSETS_BASE_URL && String(env.ASSETS_BASE_URL).trim()) ||
    'https://inneranimalmedia.com';
  const shareUrl = `${base.replace(/\/$/, '')}/dashboard/projects/${encodeURIComponent(String(projectId))}`;
  const message = String(body.message || '').trim();
  const role = String(body.role || 'editor').trim().toLowerCase() === 'viewer' ? 'viewer' : 'editor';
  const rawEmails = Array.isArray(body.emails) ? body.emails : body.email ? [body.email] : [];
  const emails = [...new Set(rawEmails.map((e) => String(e || '').trim().toLowerCase()).filter((e) => e.includes('@')))];

  const invited = [];
  const emailErrors = [];

  for (const email of emails) {
    const fakeReq = new Request('http://local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    const add = await handleProjectCollaboratorsPost(fakeReq, env, authUser, projectId);
    if (add.status >= 400) {
      emailErrors.push({ email, error: 'invite_failed' });
      continue;
    }
    invited.push(email);

    const inviter = authUser.email ? String(authUser.email) : 'A teammate';
    const subject = `${inviter} shared project “${row.name}” with you`;
    const text =
      `${inviter} invited you to collaborate on “${row.name}” (${role} access).\n\n` +
      `Open project: ${shareUrl}\n` +
      (message ? `\nMessage:\n${message}\n` : '') +
      `\nSign in at ${base.replace(/\/$/, '')}/auth/login if needed.`;

    const sent = await sendResendEmail(env, {
      to: email,
      subject,
      text,
      tags: [{ name: 'type', value: 'project_share' }],
    });
    if (sent?.error) emailErrors.push({ email, error: sent.error });
  }

  const collabRes = await handleProjectCollaboratorsGet(env, authUser, projectId);
  const collabJson = await collabRes.json();

  return jsonResponse({
    ok: true,
    share_url: shareUrl,
    invited,
    email_errors: emailErrors,
    collaborators: collabJson.collaborators ?? [],
    copy_only: emails.length === 0,
  });
}

export async function handleProjectActivate(request, env, authUser, projectId, ctx) {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first();
  if (!row) return jsonResponse({ ok: false, error: 'not_found' }, 404);
  if (
    authUser.tenant_id &&
    row.tenant_id &&
    String(row.tenant_id) !== String(authUser.tenant_id)
  ) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403);
  }

  const bindings = normalizeWorkspaceBindings(await resolveWorkspaceBindings(env, projectId));
  const executionWorkspaceId =
    bindings?.workspaceId ||
    (row.workspace_id != null ? String(row.workspace_id).trim() : null) ||
    null;

  if (executionWorkspaceId) {
    const heal = await healProjectWorkspaceId(env, projectId, executionWorkspaceId, row.workspace_id);
    if (heal.healed) row.workspace_id = executionWorkspaceId;
  }

  let workspaceActivated = false;
  if (executionWorkspaceId && authUser?.id) {
    const allowed = await userCanAccessWorkspace(env, authUser, executionWorkspaceId);
    if (allowed) {
      // Project activate scopes execution context (KV + client sessionStorage) only.
      // auth_users.active_workspace_id changes only via WorkspaceLauncher / settings switcher.
      // Never clobber workspaces.github_repo here — many projects share one workspace.
      workspaceActivated = true;
    }
  }

  const projectGithubRepo = await resolveProjectGithubRepo(env, row, bindings);

  if (env?.SESSION_CACHE && authUser?.id) {
    const { writeActiveProjectSessionContext } = await import('../../core/session-context-kv-bridge.js');
    await writeActiveProjectSessionContext(env, String(authUser.id), {
      project_id: String(projectId),
      project_name: String(row.name || projectId),
      execution_workspace_id: executionWorkspaceId,
      github_repo: projectGithubRepo,
      activated_at: Date.now(),
    }).catch(() => null);
  }

  let firstConnectIndex = null;
  if (workspaceActivated && executionWorkspaceId && projectGithubRepo) {
    const existingFull = await env.DB.prepare(
      `SELECT id, status FROM agentsam_code_index_job
        WHERE workspace_id = ? AND repo_full_name = ? AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN}
        ORDER BY rowid DESC LIMIT 1`,
    )
      .bind(executionWorkspaceId, projectGithubRepo)
      .first()
      .catch(() => null);
    if (!existingFull?.id) {
      const { queueFullCodeIndexRun } = await import(
        '../../../backend/agentsam/codebase/deploy-code-index-queue.js'
      );
      firstConnectIndex = await queueFullCodeIndexRun(env, {
        workspaceId: executionWorkspaceId,
        repoFullName: projectGithubRepo,
        userId: authUser?.id ?? null,
        projectId: projectId != null ? String(projectId) : null,
        personUuid: authUser?.person_uuid ?? null,
        branch: undefined,
        triggeredBy: 'project_first_github_connect',
      });
      // MY_QUEUE batch is enqueued inside queueFullCodeIndexRun; waitUntil pump is fallback only.
      if (firstConnectIndex?.ok && firstConnectIndex?.run_id && firstConnectIndex.queue_enqueued !== true) {
      const { pumpFullCodeIndexRun } = await import(
        '../../../backend/agentsam/codebase/code-indexer.js'
      );
        const firstBatch = pumpFullCodeIndexRun(env, firstConnectIndex.run_id, {
          maxRounds: 4,
          maxFiles: 8,
          maxSymbols: 24,
          wallBudgetMs: 28_000,
        });
        if (ctx?.waitUntil) {
          ctx.waitUntil(firstBatch.catch((error) => console.error('[project-first-connect-index]', error)));
        } else {
          void firstBatch.catch((error) => console.error('[project-first-connect-index]', error));
        }
      }
    }
  }

  return jsonResponse({
    ok: true,
    project: {
      id: row.id,
      name: row.name,
      client_id: row.client_id ?? null,
      workspace_id: row.workspace_id ?? null,
      status: row.status ?? null,
    },
    execution_workspace_id: executionWorkspaceId,
    bindings: {
      ...(bindings || {}),
      githubRepo: projectGithubRepo,
    },
    github_repo: projectGithubRepo,
    workspace_activated: workspaceActivated,
    first_connect_index: firstConnectIndex,
  });
}

export async function handleProjectWorkContext(env, authUser, projectId) {
  const row = await env.DB.prepare(`SELECT * FROM projects WHERE id = ?`).bind(projectId).first();
  if (!row) return jsonResponse({ ok: false, error: 'not_found' }, 404);
  if (
    authUser.tenant_id &&
    row.tenant_id &&
    String(row.tenant_id) !== String(authUser.tenant_id)
  ) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403);
  }
  const bindings = normalizeWorkspaceBindings(await resolveWorkspaceBindings(env, projectId));
  if (bindings?.workspaceId) {
    const heal = await healProjectWorkspaceId(env, projectId, bindings.workspaceId, row.workspace_id);
    if (heal.healed) row.workspace_id = bindings.workspaceId;
  }
  const projectGithubRepo = await resolveProjectGithubRepo(env, row, bindings);
  return jsonResponse({
    ok: true,
    project: {
      id: row.id,
      name: row.name,
      client_id: row.client_id ?? null,
      workspace_id: row.workspace_id ?? null,
    },
    execution_workspace_id:
      bindings?.workspaceId ||
      (row.workspace_id != null ? String(row.workspace_id).trim() : null) ||
      null,
    bindings: {
      ...(bindings || {}),
      githubRepo: projectGithubRepo,
    },
    github_repo: projectGithubRepo,
  });
}
