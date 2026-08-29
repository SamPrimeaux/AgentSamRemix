/**
 * Agent Sam subagent profile tools + workflow runner.
 *
 * Subagent CRUD uses D1 `agentsam_subagent_profile` (singular table name).
 * Workflow execution delegates to the canonical backend/workflows domain.
 */
import {
  createSubagentProfile,
  getSubagentProfileBySlug,
  listSubagentProfilesForScope,
} from '../subagents/profile-store.js';

function toolSessionContext(params) {
  const s = params?.session && typeof params.session === 'object' ? params.session : {};
  const workspaceId =
    (params.workspace_id != null && String(params.workspace_id).trim()) ||
    (s.workspace_id != null && String(s.workspace_id).trim()) ||
    (s.workspaceId != null && String(s.workspaceId).trim()) ||
    '';
  const tenantId =
    (params.tenant_id != null && String(params.tenant_id).trim()) ||
    (s.tenant_id != null && String(s.tenant_id).trim()) ||
    '';
  const userId =
    (params.user_id != null && String(params.user_id).trim()) ||
    (s.user_id != null && String(s.user_id).trim()) ||
    null;
  return { workspaceId, tenantId, userId };
}

export const handlers = {
  async agentsam_list_agents(params, env) {
    if (!env?.DB) return { error: 'Agent Sam Error: DB not configured' };
    const { workspaceId, tenantId, userId } = toolSessionContext(params);
    if (!userId) return { error: 'Agent Sam Error: user_id required' };
    try {
      const rows = await listSubagentProfilesForScope(env, {
        userId,
        workspaceId,
        tenantId,
        includePlatformGlobal: true,
      });
      return {
        success: true,
        table: 'agentsam_subagent_profile',
        subagents: rows,
        count: rows.length,
      };
    } catch (e) {
      return { error: `Agent Sam Error: ${e instanceof Error ? e.message : String(e)}` };
    }
  },

  async agentsam_get_agent(params, env) {
    if (!env?.DB) return { error: 'Agent Sam Error: DB not configured' };
    const { workspaceId, tenantId, userId } = toolSessionContext(params);
    if (!userId) return { error: 'Agent Sam Error: user_id required' };
    const slug = String(
      params.slug || params.agent_slug || params.profile_slug || params.agent_id || '',
    ).trim();
    const runId = String(params.id || params.run_id || '').trim();
    if (!slug && runId) {
      return handlers.agentsam_get_workflow_run({ ...params, id: runId }, env);
    }
    if (!slug) return { error: 'Agent Sam Error: slug required' };
    try {
      const row = await getSubagentProfileBySlug(env, { userId, workspaceId, tenantId }, slug);
      if (!row && runId) {
        return handlers.agentsam_get_workflow_run({ ...params, id: runId }, env);
      }
      if (!row) {
        return {
          error: 'Agent Sam Error: subagent not found',
          slug,
          table: 'agentsam_subagent_profile',
        };
      }
      return { success: true, table: 'agentsam_subagent_profile', subagent: row };
    } catch (e) {
      return { error: `Agent Sam Error: ${e instanceof Error ? e.message : String(e)}` };
    }
  },

  async agentsam_create_subagent(params, env) {
    if (!env?.DB) return { error: 'Agent Sam Error: DB not configured' };
    const { workspaceId, tenantId, userId } = toolSessionContext(params);
    if (!userId) return { error: 'Agent Sam Error: user_id required' };
    if (!workspaceId) return { error: 'Agent Sam Error: workspace_id required' };
    try {
      const out = await createSubagentProfile(
        env,
        { userId, workspaceId, tenantId },
        {
          display_name: params.display_name ?? params.displayName ?? params.name,
          slug: params.slug,
          description: params.description,
          instructions_markdown: params.instructions_markdown ?? params.instructions,
          allowed_tool_globs: params.allowed_tool_globs ?? params.tools,
          default_model_id: params.default_model_id ?? params.model_id,
          personality_tone: params.personality_tone,
          sandbox_mode: params.sandbox_mode,
          model_reasoning_effort: params.model_reasoning_effort,
          access_mode: params.access_mode,
          agent_type: params.agent_type,
          run_in_background: params.run_in_background,
          sort_order: params.sort_order,
        },
      );
      if (!out.ok) {
        return {
          error: `Agent Sam Error: ${out.error || 'create_failed'}`,
          table: 'agentsam_subagent_profile',
          slug: out.slug || null,
        };
      }
      return {
        success: true,
        table: 'agentsam_subagent_profile',
        id: out.id,
        slug: out.slug,
        subagent: out.subagent,
      };
    } catch (e) {
      return { error: `Agent Sam Error: ${e instanceof Error ? e.message : String(e)}` };
    }
  },

  async agentsam_run_agent(params, env) {
    const workflowKey = String(
      params.workflow_key || params.workflowKey || params.agent_id || params.agent_key || '',
    ).trim();
    if (!workflowKey) {
      return { error: 'Agent Sam Error: workflow_key (or agent_id) required' };
    }
    const { workspaceId, tenantId, userId } = toolSessionContext(params);
    if (!workspaceId) {
      return { error: 'Agent Sam Error: workspace context required (workspace_id on tool params)' };
    }
    if (!tenantId) {
      return { error: 'Agent Sam Error: tenant context required (tenant_id on tool params)' };
    }
    if (!env?.DB) return { error: 'Agent Sam Error: DB not configured' };
    try {
      const { executeWorkflow } = await import('../../workflows/index.js');
      let input = {};
      if (params.input && typeof params.input === 'object') input = { ...params.input };
      else if (params.prompt != null && String(params.prompt).trim()) {
        input = { message: String(params.prompt).trim() };
      }
      return await executeWorkflow(env, {
        workflowKey,
        input,
        tenantId,
        workspaceId,
        userId,
        userEmail: params.user_email != null ? String(params.user_email) : null,
        triggerType: params.trigger_type != null ? String(params.trigger_type) : 'agent',
      });
    } catch (e) {
      return { error: `Agent Sam Error: ${e instanceof Error ? e.message : String(e)}` };
    }
  },

  async agentsam_multitask_spawn(params, env) {
    const { workspaceId, tenantId, userId } = toolSessionContext(params);
    if (!userId) return { error: 'Agent Sam Error: user_id required' };
    if (!workspaceId) return { error: 'Agent Sam Error: workspace_id required' };
    try {
      const { acceptMultitaskSpawn } = await import('../runtime/spawn/orchestrator.js');
      const ctx =
        params.executionCtx ||
        params._executionCtx ||
        params.ctx || {
          waitUntil(p) {
            void Promise.resolve(p).catch((e) =>
              console.warn('[agentsam_multitask_spawn] waitUntil', e?.message ?? e),
            );
          },
        };
      return await acceptMultitaskSpawn(env, ctx, {
        userId,
        workspaceId,
        tenantId,
        conversationId: params.conversation_id ?? params.conversationId ?? null,
        sessionId: params.session_id ?? params.sessionId ?? null,
        lanes: params.lanes,
        merge: params.merge ?? params.merge_strategy,
        parentRunId: params.parent_run_id ?? params.parentRunId ?? null,
        costCapUsd: params.cost_cap_usd ?? params.costCapUsd ?? null,
        laneCostCapUsd: params.lane_cost_cap_usd ?? params.laneCostCapUsd ?? null,
        timeoutSeconds: params.timeout_seconds ?? params.timeoutSeconds ?? null,
        laneTimeoutSeconds: params.lane_timeout_seconds ?? params.laneTimeoutSeconds ?? null,
      });
    } catch (e) {
      return { error: `Agent Sam Error: ${e instanceof Error ? e.message : String(e)}` };
    }
  },

  async agentsam_multitask_status(params, env) {
    const { workspaceId, userId } = toolSessionContext(params);
    if (!userId) return { error: 'Agent Sam Error: user_id required' };
    try {
      const { getMultitaskStatus } = await import('../runtime/spawn/orchestrator.js');
      return await getMultitaskStatus(env, {
        userId,
        workspaceId,
        spawnJobId: params.spawn_job_id ?? params.fanout_id ?? params.spawnJobId ?? params.fanoutId,
      });
    } catch (e) {
      return { error: `Agent Sam Error: ${e instanceof Error ? e.message : String(e)}` };
    }
  },

  async agentsam_multitask_cancel(params, env) {
    const { workspaceId, userId } = toolSessionContext(params);
    if (!userId) return { error: 'Agent Sam Error: user_id required' };
    if (!workspaceId) return { error: 'Agent Sam Error: workspace_id required' };
    try {
      const { cancelMultitaskFanout } = await import('../runtime/spawn/orchestrator.js');
      return await cancelMultitaskFanout(env, {
        userId,
        workspaceId,
        spawnJobId: params.spawn_job_id ?? params.fanout_id ?? params.spawnJobId ?? params.fanoutId,
        reason: params.reason ?? 'operator_cancelled',
      });
    } catch (e) {
      return { error: `Agent Sam Error: ${e instanceof Error ? e.message : String(e)}` };
    }
  },

  /**
   * Provisional R2 staging — destination-agnostic. Does not ship to github/fsa/sandbox.
   */
  async agentsam_stage_file(params, env) {
    const { workspaceId, userId } = toolSessionContext(params);
    const conversationId = String(
      params.conversation_id ||
        params.conversationId ||
        params.session_id ||
        params.sessionId ||
        params.session?.conversation_id ||
        params.session?.session_id ||
        '',
    ).trim();
    if (!workspaceId) return { ok: false, error: 'workspace_id_required' };
    if (!conversationId) return { ok: false, error: 'conversation_id_required' };
    try {
      const { stageFileToR2 } = await import('../../../src/core/agentsam-stage-file.js');
      return await stageFileToR2(env, {
        path: params.path ?? params.file_path ?? params.file,
        content: params.content,
        mime: params.mime ?? params.content_type ?? params.contentType ?? null,
        workspaceId,
        conversationId,
        userId,
      });
    } catch (e) {
      return {
        ok: false,
        error: 'stage_file_failed',
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  },

  /** Poll workflow run status (legacy id param). Subagent profiles: use agentsam_get_agent + slug. */
  async agentsam_get_workflow_run(params, env) {
    const id = String(params.id || params.run_id || '').trim();
    if (!id) return { error: 'Agent Sam Error: id or run_id required' };
    if (!env?.DB) return { error: 'Agent Sam Error: DB not configured' };
    try {
      const { getWorkflowRun } = await import('../../workflows/index.js');
      const row = await getWorkflowRun(env, id);
      if (!row) return { error: 'Agent Sam Error: workflow run not found', id };
      return { run: row };
    } catch (e) {
      return { error: `Agent Sam Error: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
};
