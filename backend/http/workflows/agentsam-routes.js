/** Agent Sam workflow HTTP routes. Domain behavior lives in backend/workflows. */
import { jsonResponse } from '../agentsam/shared.js';
import { fallbackSystemTenantId } from '../../identity/users/tenant.js';
import { resolveWorkflowRequestScope } from './scope.js';
import { streamWorkflowSse, streamWorkflowResumeSse } from './sse.js';
import {
  resolveWorkflowExecutionStrategy,
  startDurableWorkflow,
  shouldUseDurableWorkflow,
  loadWorkflowGraph,
  loadWorkflowStudioModel,
  requireWorkflowGraphContext,
  saveWorkflowCanvasLayout,
  createWorkflowNode,
  updateWorkflowNode,
  deleteWorkflowNode,
  createWorkflowEdge,
  deleteWorkflowEdge,
  patchWorkflowRegistry,
  listWorkflowHandlers,
  getWorkflowById,
  createWorkflowDefinition,
  listWorkflowStudioCatalog,
  loadWorkflowRunDetail,
  transitionWorkflowApproval,
} from '../../workflows/index.js';

export async function handleAgentSamWorkflowRoutes(request, url, env, authUser) {
  const path = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();

    // ── Workflow APIs ────────────────────────────────────────────────────────

    // POST /api/agentsam/workflows — create registry row + starter trigger node
    if (path === '/api/agentsam/workflows' && method === 'POST') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      try {
        const body = await request.json().catch(() => ({}));
        const wfScope = await resolveWorkflowRequestScope(request, env, authUser);
        const tenantId =
          wfScope.tenantId ??
          (await fallbackSystemTenantId(env).catch(() => null));
        const created = await createWorkflowDefinition(env.DB, {
          tenantId,
          workspaceId: wfScope.workspaceId,
          displayName: body.display_name || body.name || 'New workflow',
          workflowKey: body.workflow_key || null,
          description: body.description || 'Created in Workflow Studio',
        });
        if (!created.ok) {
          return jsonResponse(
            { error: created.error, workflow_key: created.workflow_key ?? null },
            created.status || 400,
          );
        }
        return jsonResponse(
          { ok: true, id: created.id, workflow_key: created.workflow_key, display_name: created.display_name },
          201,
        );
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }

    // GET /api/agentsam/workflows — list active workflows with node/edge counts
    if (path === '/api/agentsam/workflows' && method === 'GET') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      try {
        const wfScope = await resolveWorkflowRequestScope(request, env, authUser);
        const wsId = wfScope.workspaceId;
        const wfUserId = wfScope.userId || String(authUser?.id || '').trim();
        if (!wsId || !wfUserId) return jsonResponse([]);
        const rows = await listWorkflowStudioCatalog(env.DB, { workspaceId: wsId, userId: wfUserId });
        return jsonResponse(rows);
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }

    // POST /api/agentsam/workflows/:id/run — SSE (fast) or CF Workflows (durable) via metadata
    const wfRunMatch = path.match(/^\/api\/agentsam\/workflows\/([^/]+)\/run$/);
    if (wfRunMatch && method === 'POST') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      const wfId = wfRunMatch[1];
      try {
        const workflow = await getWorkflowById(env.DB, wfId);
        if (!workflow) return jsonResponse({ error: 'workflow not found' }, 404);

        const body = await request.json().catch(() => ({}));
        const wfScope = await resolveWorkflowRequestScope(request, env, authUser);
        const workspaceId = wfScope.workspaceId ?? body.workspace_id ?? null;

        const tenantId = authUser?.tenant_id ?? null;
        const graphBundle = await loadWorkflowGraph(env.DB, wfId, tenantId, workspaceId);
        const nodeCount = graphBundle?.nodes?.length ?? 0;
        const strategyOverride = body.execution_strategy ?? body.executionStrategy ?? body.execution_engine ?? body.executionEngine ?? null;
        const useDurable = shouldUseDurableWorkflow(env, workflow, {
          override: strategyOverride,
          nodeCount,
        });

        if (useDurable) {
          const durable = await startDurableWorkflow(env, {
            workflow,
            input: body.input ?? body.message ?? {},
            authUser,
            workspaceId,
            executionStrategyOverride: strategyOverride,
          });
          if (!durable.ok) {
            return jsonResponse({ error: durable.error, run_id: durable.run_id ?? null }, 502);
          }
          return jsonResponse({
            ok: true,
            mode: 'durable',
            execution_strategy: resolveWorkflowExecutionStrategy(workflow, { override: strategyOverride, nodeCount }),
            execution_engine: 'durable',
            run_id: durable.run_id,
            instance_id: durable.instance_id,
            status_url: `/api/agentsam/workflow-runs/${durable.run_id}`,
            poll_url: `/api/agentsam/workflow-runs/${durable.run_id}`,
            steps_total: durable.steps_total,
          });
        }

        const { readable, writable } = new TransformStream();
        const controller = {
          _enc: new TextEncoder(),
          _writer: writable.getWriter(),
          enqueue(chunk) { void this._writer.write(chunk); },
          close() { void this._writer.close().catch(() => {}); },
        };

        // Fire the graph executor asynchronously so we can return the stream immediately
        void (async () => {
          try {
            await streamWorkflowSse(
              env,
              workflow.workflow_key,
              body.input ?? body.message ?? {},
              authUser,
              workspaceId,
              controller,
            );
          } catch (e) {
            try {
              const enc = new TextEncoder();
              controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'workflow_error', message: e?.message ?? String(e) })}\n\n`));
              controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
              controller.close();
            } catch (_) {}
          }
        })();

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Workflow-Execution-Strategy': 'inline',
            'X-Workflow-Execution-Engine': 'inline',
          },
        });
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }


  // GET /api/agentsam/workflow-node-handlers
  // DB-driven palette for Workflow Studio. Replaces hardcoded EXECUTOR_NODE_TYPES.
  if (path === '/api/agentsam/workflow-node-handlers' && method === 'GET') {
    const node_type    = url.searchParams.get('node_type')    || undefined;
    const executor_kind = url.searchParams.get('executor_kind') || undefined;
    const rows = await listWorkflowHandlers(env, { node_type, executor_kind });
    const palette = {};
    for (const row of rows) {
      if (!palette[row.node_type]) palette[row.node_type] = [];
      palette[row.node_type].push(row);
    }
    return jsonResponse({ handlers: rows, palette, total: rows.length });
  }

// GET /api/agentsam/workflow-runs/:id — run status + steps + approvals
    const wfRunStatusMatch = path.match(/^\/api\/agentsam\/workflow-runs\/([^/]+)$/);
    if (wfRunStatusMatch && method === 'GET') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      const runId = wfRunStatusMatch[1];
      try {
        const runScope = await resolveWorkflowRequestScope(request, env, authUser);
        const wsId = runScope.workspaceId;
        const runUserId = runScope.userId || String(authUser?.id || '').trim();
        const detail = await loadWorkflowRunDetail(env.DB, {
          runId,
          userId: runUserId,
          workspaceId: wsId || '',
        });
        if (!detail) return jsonResponse({ error: 'run not found' }, 404);
        const plan = await env.DB.prepare(
          `SELECT * FROM agentsam_plans WHERE workflow_run_id = ? ORDER BY created_at DESC LIMIT 1`,
        ).bind(runId).first().catch(() => null);
        return jsonResponse({ ...detail, plan: plan || null });
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }

    // POST /api/agentsam/workflow-runs/:id/approve — approve/deny a pending approval gate
    const wfApproveMatch = path.match(/^\/api\/agentsam\/workflow-runs\/([^/]+)\/approve$/);
    if (wfApproveMatch && method === 'POST') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      const runId = wfApproveMatch[1];
      try {
        const body = await request.json().catch(() => ({}));
        const decision = String(body.decision || 'approved').toLowerCase();
        const approvalId = body.approval_id ? String(body.approval_id) : null;

        if (!['approved', 'denied', 'rejected'].includes(decision)) {
          return jsonResponse({ error: 'decision must be approved or denied' }, 400);
        }
        const approvalScope = await resolveWorkflowRequestScope(request, env, authUser);
        if (!approvalScope.tenantId || !approvalScope.workspaceId) {
          return jsonResponse({ error: 'workflow scope unavailable' }, 403);
        }
        const approval = await transitionWorkflowApproval(env, {
          runId,
          approvalId,
          decision,
          approvedBy: authUser?.id ?? approvalScope.userId ?? null,
          tenantId: approvalScope.tenantId,
          workspaceId: approvalScope.workspaceId,
        });
        if (!approval.ok) {
          return jsonResponse({ error: approval.error }, approval.error === 'approval_not_found_or_decided' ? 404 : 400);
        }

        return jsonResponse({ ok: true, decision: approval.decision, run_id: runId, rows_updated: approval.changes });
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }

    // POST /api/agentsam/workflow-runs/:id/resume — continue DAG after approval (SSE)
    const wfResumeMatch = path.match(/^\/api\/agentsam\/workflow-runs\/([^/]+)\/resume$/);
    if (wfResumeMatch && method === 'POST') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      const runId = wfResumeMatch[1];
      try {
        const wfScope = await resolveWorkflowRequestScope(request, env, authUser);
        const workspaceId = wfScope.workspaceId ?? null;
        const { readable, writable } = new TransformStream();
        const controller = {
          _enc: new TextEncoder(),
          _writer: writable.getWriter(),
          enqueue(chunk) { void this._writer.write(chunk); },
          close() { void this._writer.close().catch(() => {}); },
        };
        void streamWorkflowResumeSse(env, runId, authUser, workspaceId, controller).catch(
          (e) => {
            try {
              const enc = new TextEncoder();
              controller.enqueue(
                enc.encode(
                  `data: ${JSON.stringify({ type: 'workflow_error', message: e?.message ?? String(e) })}\n\n`,
                ),
              );
              controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
              controller.close();
            } catch (_) {}
          },
        );
        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }

    // ── Workflow graph CRUD (registry id in path; DAG rows use dag_workflow_id) ──
    async function workflowScope() {
      const scope = await resolveWorkflowRequestScope(request, env, authUser);
      const tenantId =
        scope.tenantId ??
        (await fallbackSystemTenantId(env).catch(() => null));
      return {
        tenantId: tenantId != null ? String(tenantId) : null,
        workspaceId: scope.workspaceId ?? null,
      };
    }

    const wfLayoutMatch = path.match(/^\/api\/agentsam\/workflows\/([^/]+)\/layout$/);
    if (wfLayoutMatch && method === 'PATCH') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      const registryId = decodeURIComponent(wfLayoutMatch[1]);
      try {
        const body = await request.json().catch(() => ({}));
        const positions =
          body.positions && typeof body.positions === 'object' ? body.positions : body;
        const { tenantId, workspaceId } = await workflowScope();
        const out = await saveWorkflowCanvasLayout(
          env.DB,
          registryId,
          positions,
          tenantId,
          workspaceId,
        );
        if (out.error) return jsonResponse({ error: out.error }, out.status);
        return jsonResponse(out);
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }

    const wfNodeKeyMatch = path.match(/^\/api\/agentsam\/workflows\/([^/]+)\/nodes\/([^/]+)$/);
    if (wfNodeKeyMatch && (method === 'PATCH' || method === 'DELETE')) {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      const registryId = decodeURIComponent(wfNodeKeyMatch[1]);
      const nodeKey = decodeURIComponent(wfNodeKeyMatch[2]);
      try {
        const { tenantId, workspaceId } = await workflowScope();
        const ctx = await requireWorkflowGraphContext(env.DB, registryId, tenantId, workspaceId);
        if (ctx.error) return jsonResponse({ error: ctx.error }, ctx.status);
        const { dag_workflow_id: dagId } = ctx.bundle;
        if (method === 'DELETE') {
          const out = await deleteWorkflowNode(env.DB, { dagWorkflowId: dagId, nodeKey });
          if (out.error) return jsonResponse({ error: out.error }, out.status);
          return jsonResponse(out);
        }
        const body = await request.json().catch(() => ({}));
        const out = await updateWorkflowNode(env.DB, {
          dagWorkflowId: dagId,
          nodeKey,
          body,
        });
        if (out.error) return jsonResponse({ error: out.error }, out.status);
        return jsonResponse(out);
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }

    const wfNodesPostMatch = path.match(/^\/api\/agentsam\/workflows\/([^/]+)\/nodes$/);
    if (wfNodesPostMatch && method === 'POST') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      const registryId = decodeURIComponent(wfNodesPostMatch[1]);
      try {
        const { tenantId, workspaceId } = await workflowScope();
        const ctx = await requireWorkflowGraphContext(env.DB, registryId, tenantId, workspaceId);
        if (ctx.error) return jsonResponse({ error: ctx.error }, ctx.status);
        const body = await request.json().catch(() => ({}));
        const out = await createWorkflowNode(env.DB, {
          registryId,
          dagWorkflowId: ctx.bundle.dag_workflow_id,
          body,
        });
        if (out.error) return jsonResponse({ error: out.error }, out.status);
        return jsonResponse(out, 201);
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }

    const wfEdgeIdMatch = path.match(/^\/api\/agentsam\/workflows\/([^/]+)\/edges\/([^/]+)$/);
    if (wfEdgeIdMatch && method === 'DELETE') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      const registryId = decodeURIComponent(wfEdgeIdMatch[1]);
      const edgeId = decodeURIComponent(wfEdgeIdMatch[2]);
      try {
        const { tenantId, workspaceId } = await workflowScope();
        const ctx = await requireWorkflowGraphContext(env.DB, registryId, tenantId, workspaceId);
        if (ctx.error) return jsonResponse({ error: ctx.error }, ctx.status);
        const out = await deleteWorkflowEdge(env.DB, {
          dagWorkflowId: ctx.bundle.dag_workflow_id,
          edgeId,
        });
        if (out.error) return jsonResponse({ error: out.error }, out.status);
        return jsonResponse(out);
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }

    const wfEdgesPostMatch = path.match(/^\/api\/agentsam\/workflows\/([^/]+)\/edges$/);
    if (wfEdgesPostMatch && method === 'POST') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      const registryId = decodeURIComponent(wfEdgesPostMatch[1]);
      try {
        const { tenantId, workspaceId } = await workflowScope();
        const ctx = await requireWorkflowGraphContext(env.DB, registryId, tenantId, workspaceId);
        if (ctx.error) return jsonResponse({ error: ctx.error }, ctx.status);
        const body = await request.json().catch(() => ({}));
        const out = await createWorkflowEdge(env.DB, {
          dagWorkflowId: ctx.bundle.dag_workflow_id,
          body,
        });
        if (out.error) return jsonResponse({ error: out.error }, out.status);
        return jsonResponse(out, 201);
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }

    const wfSingleMatch = path.match(/^\/api\/agentsam\/workflows\/([^/]+)$/);
    if (wfSingleMatch && method === 'GET') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      const registryId = decodeURIComponent(wfSingleMatch[1]);
      try {
        const { tenantId, workspaceId } = await workflowScope();
        const bundle = await loadWorkflowStudioModel(env.DB, registryId, tenantId, workspaceId);
        if (!bundle) return jsonResponse({ error: 'workflow not found' }, 404);
        return jsonResponse({
          workflow: bundle.workflow,
          registry_workflow_id: bundle.registry_workflow_id,
          dag_workflow_id: bundle.dag_workflow_id,
          nodes: bundle.nodes,
          edges: bundle.edges,
          canvas_layout: bundle.canvas_layout,
          runs_summary: bundle.runs_summary,
        });
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }

    if (wfSingleMatch && method === 'PATCH') {
      if (!env.DB) return jsonResponse({ error: 'DB unavailable' }, 503);
      const registryId = decodeURIComponent(wfSingleMatch[1]);
      try {
        const body = await request.json().catch(() => ({}));
        const out = await patchWorkflowRegistry(env.DB, registryId, body, {
          userId: authUser?.id ?? null,
        });
        if (out.error) return jsonResponse({ error: out.error }, out.status);
        return jsonResponse(out);
      } catch (e) {
        return jsonResponse({ error: e?.message ?? String(e) }, 500);
      }
    }


  return null;
}
