/**
 * API Service: Agent Sam Capability Layer
 * Handles registry lookups for managed agents, skills, and invocation auditing.
 * Interfaces with agentsam_subagent_profile, agentsam_skill, and agentsam_skill_invocation.
 */
import { handlers as db } from '../../backend/agentsam/tools/db.js';
import {
  getAuthUser,
  jsonResponse,
  fetchAuthUserTenantId,
  fallbackSystemTenantId,
} from '../core/auth.js';
import { resolveIamActorContext } from '../core/identity.js';
import {
  resolveEffectiveWorkspaceId,
  WORKSPACE_CONTEXT_MISSING,
} from '../../backend/identity/bootstrap.js';
import { insertAgentsamPlanRow, insertAgentsamPlanTaskRows } from '../core/agentsam-plan-insert.js';
import {
  createPlanExcalidrawArtifact,
  createPlanMarkdownArtifact,
} from '../core/agentsam-plan-excalidraw-artifact.js';
import { resolveAgentDataScope } from '../../backend/http/agentsam/routes/scope.js';

/**
 * HTTP entry for /api/agentsam/* (registry, prompts, etc.).
 */
export async function handleAgentSamApi(request, url, env, ctx) {
  const authUser = await getAuthUser(request, env);
  if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);
  const out = await handleAgentSamRegistryRequest(request, env, ctx, authUser);
  if (out) return out;
  return jsonResponse({ error: 'API route not found' }, 404);
}
/**
 * Main switch-board for Agent Sam Registry requests.
 */
export async function handleAgentSamRegistryRequest(request, env, ctx, authUser) {
    const url = new URL(request.url);
    const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
    const method = request.method.toUpperCase();
    if (path === '/api/agentsam/spawn-tree' && method === 'GET') {
      const { handleAgentsamSpawnTree } = await import('./agentsam/spawn-tree.js');
      return handleAgentsamSpawnTree(request, url, env, authUser);
    }

    if (path === '/api/agentsam/multitask-spawn' && method === 'POST') {
      const { handleMultitaskSpawn } = await import('./agentsam/multitask-spawn.js');
      return handleMultitaskSpawn(request, env, ctx, { internal: false });
    }

    if (path === '/api/agentsam/multitask-status' && (method === 'GET' || method === 'POST')) {
      const { handleMultitaskStatus } = await import('./agentsam/multitask-spawn.js');
      return handleMultitaskStatus(request, env, { internal: false });
    }

    if (path === '/api/agentsam/multitask-cancel' && method === 'POST') {
      const { handleMultitaskCancel } = await import('./agentsam/multitask-spawn.js');
      return handleMultitaskCancel(request, env, { internal: false });
    }

    const planIdMatch = path.match(/^\/api\/agentsam\/plans\/([^/]+)$/);
    if (planIdMatch && method === 'PATCH') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      const planId = decodeURIComponent(planIdMatch[1] || '').trim();
      const body = await request.json().catch(() => ({}));
      const status = String(body.status ?? '').trim().toLowerCase();
      if (!planId) return jsonResponse({ error: 'plan_id required' }, 400);
      if (!['active', 'complete', 'abandoned', 'draft'].includes(status)) {
        return jsonResponse({ error: 'status must be active|complete|abandoned|draft' }, 400);
      }

      let tenantId =
        authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
          ? String(authUser.tenant_id).trim()
          : null;
      if (!tenantId) tenantId = await fetchAuthUserTenantId(env, authUser.id);
      if (!tenantId) tenantId = fallbackSystemTenantId(env);

      const plan = await env.DB.prepare(
        `SELECT id, tenant_id, workspace_id FROM agentsam_plans WHERE id = ? LIMIT 1`,
      )
        .bind(planId)
        .first()
        .catch(() => null);
      if (!plan?.id) return jsonResponse({ error: 'plan not found' }, 404);
      if (String(plan.tenant_id || '') !== tenantId) {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }

      await env.DB.prepare(
        `UPDATE agentsam_plans SET status = ?, updated_at = unixepoch() WHERE id = ?`,
      )
        .bind(status, planId)
        .run();

      return jsonResponse({ ok: true, plan_id: planId, status });
    }

    if (path === '/api/agentsam/plans' && method === 'GET') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      const wsRes = await resolveEffectiveWorkspaceId(env, request, authUser, {});
      const workspaceId =
        url.searchParams.get('workspace_id')?.trim() ||
        wsRes?.workspaceId ||
        null;
      if (!workspaceId) {
        return jsonResponse({ error: wsRes?.error || 'workspace_id required' }, 400);
      }

      let tenantId =
        authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
          ? String(authUser.tenant_id).trim()
          : null;
      if (!tenantId) tenantId = await fetchAuthUserTenantId(env, authUser.id);
      if (!tenantId) tenantId = fallbackSystemTenantId(env);

      const statusFilter = url.searchParams.get('status')?.trim().toLowerCase() || '';
      const limit = Math.min(Math.max(1, Number(url.searchParams.get('limit')) || 20), 50);
      let sql = `SELECT id, title, status, plan_type, plan_date, tasks_total, tasks_done, tasks_blocked,
                        workflow_run_id, session_id, created_at, updated_at
                 FROM agentsam_plans
                 WHERE tenant_id = ? AND workspace_id = ?`;
      const binds = [tenantId, workspaceId];
      if (statusFilter && statusFilter !== 'all') {
        sql += ` AND status = ?`;
        binds.push(statusFilter);
      } else {
        sql += ` AND status IN ('active','draft')`;
      }
      sql += ` ORDER BY updated_at DESC LIMIT ?`;
      binds.push(limit);

      const { results } = await env.DB.prepare(sql).bind(...binds).all().catch(() => ({ results: [] }));
      return jsonResponse({ ok: true, workspace_id: workspaceId, plans: results || [] });
    }

    const planMarkdownMatch = path.match(/^\/api\/agentsam\/plans\/([^/]+)\/markdown$/);
    if (planMarkdownMatch && method === 'GET') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      const planId = decodeURIComponent(planMarkdownMatch[1] || '').trim();
      if (!planId) return jsonResponse({ error: 'plan_id required' }, 400);

      let tenantId =
        authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
          ? String(authUser.tenant_id).trim()
          : null;
      if (!tenantId) tenantId = await fetchAuthUserTenantId(env, authUser.id);
      if (!tenantId) tenantId = fallbackSystemTenantId(env);

      const plan = await env.DB.prepare(
        `SELECT id, tenant_id, title FROM agentsam_plans WHERE id = ? LIMIT 1`,
      )
        .bind(planId)
        .first()
        .catch(() => null);
      if (!plan?.id) return jsonResponse({ error: 'plan not found' }, 404);
      if (String(plan.tenant_id || '') !== tenantId) {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }

      const art = await env.DB.prepare(
        `SELECT id, public_url, r2_key, name
         FROM agentsam_artifacts
         WHERE tenant_id = ? AND user_id = ?
           AND metadata_json LIKE ?
         ORDER BY created_at DESC LIMIT 1`,
      )
        .bind(tenantId, String(authUser.id || ''), `%"plan_id":"${planId}"%`)
        .first()
        .catch(() => null);

      return jsonResponse({
        ok: true,
        plan_id: planId,
        title: plan.title,
        artifact_id: art?.id ?? null,
        public_url: art?.public_url ?? null,
        r2_key: art?.r2_key ?? null,
      });
    }

    const planTasksMatch = path.match(/^\/api\/agentsam\/plans\/([^/]+)\/tasks$/);
    if (planTasksMatch && method === 'GET') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      const planId = decodeURIComponent(planTasksMatch[1] || '').trim();
      if (!planId) return jsonResponse({ error: 'plan_id required' }, 400);

      let tenantId =
        authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
          ? String(authUser.tenant_id).trim()
          : null;
      if (!tenantId) tenantId = await fetchAuthUserTenantId(env, authUser.id);
      if (!tenantId) tenantId = fallbackSystemTenantId(env);

      const plan = await env.DB.prepare(
        `SELECT id, tenant_id FROM agentsam_plans WHERE id = ? LIMIT 1`,
      )
        .bind(planId)
        .first()
        .catch(() => null);
      if (!plan?.id) return jsonResponse({ error: 'plan not found' }, 404);
      if (String(plan.tenant_id || '') !== tenantId) {
        return jsonResponse({ error: 'Forbidden' }, 403);
      }

      const { results } = await env.DB.prepare(
        `SELECT id, plan_id, order_index, title, description, priority, category, status,
                blocked_reason, notes, estimated_minutes, actual_minutes, completed_at,
                parent_task_id
         FROM agentsam_plan_tasks
         WHERE plan_id = ?
         ORDER BY order_index ASC, id ASC`,
      )
        .bind(planId)
        .all()
        .catch(() => ({ results: [] }));

      return jsonResponse({ ok: true, plan_id: planId, tasks: results || [] });
    }

    // POST /api/agentsam/plans — create plan + optional plan_tasks (D1; pragma-safe columns)
    if (path === '/api/agentsam/plans' && method === 'POST') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      const body = await request.json().catch(() => ({}));
      const title = String(body.title ?? '').trim();
      if (!title) return jsonResponse({ error: 'title required' }, 400);

      const wsRes = await resolveEffectiveWorkspaceId(env, request, authUser, {});
      const workspaceId =
        body.workspace_id != null && String(body.workspace_id).trim() !== ''
          ? String(body.workspace_id).trim()
          : wsRes?.workspaceId ?? null;
      if (!workspaceId) {
        return jsonResponse(
          { error: wsRes?.error || 'workspace_id required', code: wsRes?.error || null },
          400,
        );
      }

      let tenantId =
        body.tenant_id != null && String(body.tenant_id).trim() !== ''
          ? String(body.tenant_id).trim()
          : authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
            ? String(authUser.tenant_id).trim()
            : null;
      if (!tenantId) tenantId = await fetchAuthUserTenantId(env, authUser.id);
      if (!tenantId) tenantId = fallbackSystemTenantId(env);

      const planIdIn = body.id != null && String(body.id).trim() !== '' ? String(body.id).trim() : undefined;
      const { id: planId } = await insertAgentsamPlanRow(
        env,
        {
        id: planIdIn,
        tenant_id: tenantId,
        workspace_id: workspaceId,
        session_id: body.session_id != null ? String(body.session_id) : null,
        agent_id: body.agent_id != null ? String(body.agent_id) : null,
        title,
        plan_type: body.plan_type,
        plan_date: body.plan_date != null ? String(body.plan_date) : undefined,
        status: body.status,
        morning_brief:
          body.morning_brief != null
            ? typeof body.morning_brief === 'string'
              ? body.morning_brief
              : JSON.stringify(body.morning_brief)
            : undefined,
        session_notes:
          body.session_notes != null
            ? typeof body.session_notes === 'string'
              ? body.session_notes
              : JSON.stringify(body.session_notes)
            : undefined,
        default_model: body.default_model != null ? String(body.default_model) : null,
        workflow_id: body.workflow_id != null ? String(body.workflow_id) : null,
        workflow_run_id: body.workflow_run_id != null ? String(body.workflow_run_id) : null,
        tasks_total: Array.isArray(body.tasks) ? body.tasks.length : body.tasks_total,
        linked_todo_ids:
          body.linked_todo_ids != null
            ? typeof body.linked_todo_ids === 'string'
              ? body.linked_todo_ids
              : JSON.stringify(body.linked_todo_ids)
            : undefined,
        linked_project_keys:
          body.linked_project_keys != null
            ? typeof body.linked_project_keys === 'string'
              ? body.linked_project_keys
              : JSON.stringify(body.linked_project_keys)
            : undefined,
        },
        ctx,
      );

      let taskIds = [];
      if (Array.isArray(body.tasks) && body.tasks.length) {
        const { ids } = await insertAgentsamPlanTaskRows(
          env,
          {
            planId,
            tenantId,
            workspaceId,
            tasks: body.tasks,
          },
          ctx,
        );
        taskIds = ids;
      }

      let visual_map = null;
      let visual_map_error = null;
      const taskCount = taskIds.length;
      let wantVisual = false;
      if (body.create_visual_map === true) wantVisual = true;
      else if (body.create_visual_map === false) wantVisual = false;
      else wantVisual = taskCount >= 2;
      if (wantVisual && env.AUTORAG_BUCKET?.put && authUser?.id) {
        try {
          visual_map = await createPlanExcalidrawArtifact(
            env,
            {
              tenantId,
              workspaceId,
              userId: String(authUser.id),
              planId,
            },
            ctx,
          );
        } catch (e) {
          visual_map_error = e?.message != null ? String(e.message) : String(e);
        }
      } else if (wantVisual && !env.AUTORAG_BUCKET?.put) {
        visual_map_error = 'AUTORAG_BUCKET binding not configured';
      } else if (wantVisual && !authUser?.id) {
        visual_map_error = 'user_id missing for artifact';
      }

      let plan_markdown = null;
      let plan_markdown_error = null;
      let wantMd = false;
      if (body.create_plan_markdown === true) wantMd = true;
      else if (body.create_plan_markdown === false) wantMd = false;
      else wantMd = true;
      if (wantMd && env.AUTORAG_BUCKET?.put && authUser?.id) {
        try {
          plan_markdown = await createPlanMarkdownArtifact(
            env,
            {
              tenantId,
              workspaceId,
              userId: String(authUser.id),
              planId,
            },
            ctx,
          );
        } catch (e) {
          plan_markdown_error = e?.message != null ? String(e.message) : String(e);
        }
      } else if (wantMd && !env.AUTORAG_BUCKET?.put) {
        plan_markdown_error = 'AUTORAG_BUCKET binding not configured';
      } else if (wantMd && !authUser?.id) {
        plan_markdown_error = 'user_id missing for artifact';
      }

      return jsonResponse(
        {
          ok: true,
          plan_id: planId,
          task_ids: taskIds,
          tasks_total: taskIds.length,
          tasks_done: 0,
          tasks_blocked: 0,
          visual_map: visual_map
            ? {
                artifact_id: visual_map.artifact_id,
                r2_key: visual_map.r2_key,
                public_url: visual_map.public_url,
              }
            : null,
          ...(visual_map_error ? { visual_map_error } : {}),
          plan_markdown: plan_markdown
            ? {
                artifact_id: plan_markdown.artifact_id,
                r2_key: plan_markdown.r2_key,
                public_url: plan_markdown.public_url,
              }
            : null,
          ...(plan_markdown_error ? { plan_markdown_error } : {}),
        },
        201,
      );
    }


    // 1. Model Registry: GET /api/agentsam/ai/:role
    if (path.startsWith('/api/agentsam/ai') && method === 'GET') {
        const parts = path.split('/');
        const role = parts[parts.length - 1]; // e.g. orchestrator, worker
        const agent = await getAgentMetadata(env, role);
        return jsonResponse(agent);
    }

    // 2. Skill Registry: GET /api/agentsam/skills
    if (path === '/api/agentsam/skills' && method === 'GET') {
        const skills = await getAgentSkills(env);
        return jsonResponse(skills);
    }

    // 3. Invocation Audit: GET /api/agentsam/invocations
    if (path === '/api/agentsam/invocations' && method === 'GET') {
        const invocations = await getInvocations(env);
        return jsonResponse(invocations);
    }

    // D1 agent_chat_plan trace (latest or ?run_id=)
    if (path === '/api/agentsam/agent-chat-plan-trace' && method === 'GET') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      const wsRes = await resolveEffectiveWorkspaceId(env, request, authUser, {});
      if (wsRes.error === WORKSPACE_CONTEXT_MISSING || !wsRes.workspaceId) {
        return jsonResponse({ error: WORKSPACE_CONTEXT_MISSING, code: WORKSPACE_CONTEXT_MISSING }, 400);
      }
      const wsId = String(wsRes.workspaceId).trim();
      const runIdParam = url.searchParams.get('run_id')?.trim();
      let run = null;
      const traceScope = await resolveAgentDataScope(env, authUser, request, {});
      const traceUserId = traceScope.userId || String(authUser?.id || '').trim();
      const [{ getWorkflowRunForScope, getLatestWorkflowRunForScope }, { resolveWorkflowTemplate }] = await Promise.all([import('../../backend/workflows/runs/repository.js'), import('../../backend/workflows/repository/workflows.js')]);
      if (runIdParam) {
        run = await getWorkflowRunForScope(env.DB, {
          runId: runIdParam,
          workspaceId: wsId,
          userId: traceUserId,
        }).catch(() => null);
      } else {
        const planningWorkflow = await resolveWorkflowTemplate(env.DB, { tenantId: traceScope.tenantId || authUser?.tenant_id || null, triggerType: 'agent', defaultTaskType: 'planning' }).catch(() => null);
        run = await getLatestWorkflowRunForScope(env.DB, {
          workspaceId: wsId,
          userId: traceUserId,
          workflowKey: planningWorkflow?.workflow_key || null,
          workflowId: planningWorkflow?.id || null,
        }).catch(() => null);
      }
      if (!run?.id) return jsonResponse({ error: 'no_run' }, 404);
      const rid = String(run.id);
      const plan = await env.DB
        .prepare(`SELECT * FROM agentsam_plans WHERE workflow_run_id = ? ORDER BY created_at DESC LIMIT 1`)
        .bind(rid)
        .first()
        .catch(() => null);
      const tasks = plan?.id
        ? (
            await env.DB
              .prepare(`SELECT * FROM agentsam_plan_tasks WHERE plan_id = ? ORDER BY order_index`)
              .bind(plan.id)
              .all()
          ).results || []
        : [];
      const steps =
        (
          await env.DB
            .prepare(`SELECT * FROM agentsam_execution_steps WHERE workflow_run_id = ? ORDER BY created_at_unix, node_key`)
            .bind(rid)
            .all()
        ).results || [];
      const approvals =
        (
          await env.DB
            .prepare(
              `SELECT * FROM agentsam_approval_queue
               WHERE workflow_run_id = ?
                  OR execution_step_id IN (SELECT id FROM agentsam_execution_steps WHERE workflow_run_id = ?)
               ORDER BY created_at DESC`,
            )
            .bind(rid, rid)
            .all()
        ).results || [];

      const crIds = new Set();
      for (const a of approvals) {
        if (a.command_run_id) crIds.add(String(a.command_run_id));
      }
      for (const t of tasks) {
        if (t.command_run_id) crIds.add(String(t.command_run_id));
      }
      let command_runs = [];
      if (crIds.size) {
        const placeholders = [...crIds].map(() => '?').join(',');
        command_runs =
          (
            await env.DB
              .prepare(
                `SELECT * FROM agentsam_command_run
                 WHERE id IN (${placeholders}) AND user_id = ? AND workspace_id = ?`,
              )
              .bind(...[...crIds], traceUserId, wsId)
              .all()
          ).results || [];
      }

      const tasksWithSteps = tasks.filter((t) => t.execution_step_id).length;
      const tasksWithWrun = tasks.filter((t) => t.workflow_run_id).length;
      const wrunMatch = tasks.filter((t) => String(t.workflow_run_id || '') === rid).length;
      const stepExecMatch = tasks.filter((t) => {
        const sid = t.execution_step_id;
        if (!sid) return false;
        const s = steps.find((x) => x.id === sid);
        return s && String(s.execution_id || '') === rid;
      }).length;

      return jsonResponse({
        workflow_run: run,
        plan,
        tasks,
        steps,
        approvals,
        command_runs,
        checks: {
          plan_has_workflow_run_id: !!plan?.workflow_run_id,
          tasks_total: tasks.length,
          tasks_with_steps: tasksWithSteps,
          tasks_with_wrun: tasksWithWrun,
          tasks_wrun_equals_run: wrunMatch,
          tasks_execution_step_matches_run: stepExecMatch,
        },
      });
    }

    // 4. Prompt Registry: GET /api/agentsam/prompts/:group
    if (path.startsWith('/api/agentsam/prompts') && method === 'GET') {
        const parts = path.split('/');
        const group = parts[parts.length - 1]; // e.g. coding
        
        if (group === 'prompts') {
            // General list (agentsam_prompt_versions replaces ai_prompts_library)
            const sql =
              'SELECT id, prompt_key AS category, 100 AS weight, is_active FROM agentsam_prompt_versions ORDER BY prompt_key ASC';
            const res = await db.d1_query({ sql }, env);
            return jsonResponse(res.results || []);
        }

        // Specific weighted selection test
        const prompt = await getActivePromptByWeight(env, group);
        return jsonResponse(prompt);
    }

    const { handleAgentSamWorkflowRoutes } = await import('../../backend/http/workflows/agentsam-routes.js');
    const workflowResponse = await handleAgentSamWorkflowRoutes(request, url, env, authUser);
    if (workflowResponse) return workflowResponse;

    return null;
}

/**
 * Performs a surgical lookup of a managed agent by its role or ID.
 */
export async function getAgentMetadata(env, roleOrId) {
    const key = String(roleOrId || '').trim();
    if (!key || !env?.DB) return { error: `Agent not found: ${roleOrId}` };
    let row;
    try {
      row = await env.DB.prepare(
        `SELECT id, slug, display_name, description, agent_type, default_model_id,
                is_active, sort_order, sandbox_mode, access_mode
         FROM agentsam_subagent_profile
         WHERE is_active = 1 AND (id = ? OR slug = ?)
         LIMIT 1`,
      )
        .bind(key, key)
        .first();
    } catch (e) {
      return { error: e?.message ?? String(e) };
    }
    if (!row) return { error: `Agent not found: ${roleOrId}` };
    return {
      ...row,
      name: row.display_name,
      role_name: row.slug,
      model_policy: { default_model: row.default_model_id || null },
      cost_policy: {},
      memory_policy: {},
      tool_permissions: {},
    };
}

/**
 * Fetches all active managed skills for Agent Sam.
 */
export async function getAgentSkills(env) {
    const sql = "SELECT * FROM agentsam_skill WHERE is_active = 1 ORDER BY sort_order ASC";
    const res = await db.d1_query({ sql }, env);
    return res.results || [];
}

/**
 * Records a skill invocation for auditing and spent-ledger calibration.
 */
export async function logSkillInvocation(env, data) {
    const sql = `
        INSERT INTO agentsam_skill_invocation 
        (skill_id, conversation_id, trigger_method, input_summary, success, error_message, duration_ms, model_used, tokens_in, tokens_out, cost_usd)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    return await db.d1_write({
        sql,
        params: [
            data.skillId,
            data.conversationId,
            data.triggerMethod || 'auto',
            data.inputSummary,
            data.success ? 1 : 0,
            data.errorMessage || null,
            data.durationMs || 0,
            data.modelUsed,
            data.tokensIn || 0,
            data.tokensOut || 0,
            data.costUsd || 0
        ]
    }, env);
}

/**
 * A/B Testing Engine: Selects an active prompt from a group based on weights.
 */
export async function getActivePromptByWeight(env, groupKey) {
    const sql = `
        SELECT id, prompt_key, version,
               body AS prompt_template, prompt_key AS category,
               100 AS weight, body_tokens, is_active, notes
        FROM agentsam_prompt_versions 
        WHERE prompt_key = ? AND is_active = 1
    `;
    const res = await db.d1_query({ sql, params: [groupKey] }, env);
    const prompts = res.results || [];

    if (!prompts.length) return null;
    if (prompts.length === 1) return prompts[0];

    // Weighted Random Selection
    const totalWeight = prompts.reduce((sum, p) => sum + (p.weight || 100), 0);
    let random = Math.random() * totalWeight;
    
    for (const prompt of prompts) {
        if (random < (prompt.weight || 100)) return prompt;
        random -= (prompt.weight || 100);
    }

    return prompts[0]; // Fallback
}

/**
 * Retrieves a specific prompt by its ID with parsed metadata.
 */
export async function getPromptMetadata(env, promptId) {
    const sql = 'SELECT * FROM agentsam_prompt_versions WHERE id = ?';
    const res = await db.d1_query({ sql, params: [promptId] }, env);
    
    if (!res.results?.length) return null;
    const prompt = res.results[0];
    prompt.prompt_template = prompt.body;
    prompt.category = prompt.prompt_key;
    try {
      prompt.metadata = JSON.parse(prompt.notes || '{}');
    } catch (_) {
      prompt.metadata = {};
    }
    return prompt;
}

/**
 * Retrieval for the spent ledger and audit trail.
 */
async function getInvocations(env) {
    const sql = "SELECT * FROM agentsam_skill_invocation ORDER BY invoked_at DESC LIMIT 100";
    const res = await db.d1_query({ sql }, env);
    return res.results || [];
}
