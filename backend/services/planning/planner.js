/**
 * Agent Sam Planner
 * Decomposes a user goal into agentsam_plans + agentsam_plan_tasks rows.
 * Decomposes goals via resolveModelForTask + dispatchComplete (D1 routing arms).
 *
 * Work-intent chat wires the proven D1 spine:
 *   workflow context is supplied by backend/workflows; planner owns plans/tasks only.
 *   → agentsam_command_run (risky tasks) → agentsam_plan_tasks → agentsam_approval_queue
 *   → execution_steps.approval_id (only after approval row exists).
 */

function planId() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return 'plan_' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
function taskId() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return 'task_' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
function stepId() {
  return `estep_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
function commandRunId() {
  return `run_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
function approvalId() {
  return `appr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

const PLANNER_SYSTEM = `You are Agent Sam's planning engine.
The user has given you a goal. Decompose it into 2-8 concrete, executable tasks for the live Agent Sam execution spine.
Return ONLY valid JSON, no markdown, no explanation:
{
  "plan_title": "short title for the plan",
  "tasks": [
    {
      "title": "short task title",
      "description": "what to do and why (include concrete paths, routes, or shell when relevant)",
      "category": "backend|frontend|db|infra|ux|research|other",
      "priority": "P0|P1|P2|P3",
      "handler_type": "agent|terminal|db_query|mcp_tool|script",
      "workflow_key": null,
      "capability_type": "monaco_edit|excalidraw_diagram|browser_capture|playwright_validation|general_agent",
      "files_involved": ["optional/repo/relative/paths.ts"],
      "routes_involved": ["/dashboard/agent"],
      "proposed_shell": "only for playwright_validation or terminal — exact command to run AFTER human approval (e.g. npx playwright test …). Empty for preview-only work.",
      "requires_approval": true,
      "estimated_minutes": 5
    }
  ]
}
Rules:
- capability_type:
  - monaco_edit: code/file edits, refactors, patch plans (Monaco surface). handler_type agent or mcp_tool. Populate files_involved when paths are known. Do NOT claim files were written unless describing a future apply step; prefer preview/plan language.
  - excalidraw_diagram: diagrams, flowcharts, whiteboards. handler_type agent or mcp_tool. No terminal, no proposed_shell.
  - browser_capture: screenshots, live DOM, console inspection. handler_type mcp_tool or agent. Include routes_involved or a URL in description. No proposed_shell unless you truly need an approved shell (normally leave empty).
  - playwright_validation: Playwright/e2e/smoke tests. handler_type MUST be terminal (or script only when the command is the Playwright runner). proposed_shell MUST contain the playwright command. requires_approval true.
  - general_agent: default when none of the above fit.
- handler_type = "agent" for LLM-only generation
- handler_type = "terminal" for shell (including Playwright test runs after approval)
- handler_type = "db_query" for D1 reads/writes (approval-gated at runtime)
- handler_type = "mcp_tool" when a concrete MCP workflow_key exists; workflow_key must match agentsam_workflows.workflow_key exactly when set
- workflow_key: only set if an existing agentsam_workflows.workflow_key matches exactly (otherwise null)
- 2 tasks minimum, 8 maximum
- P0 = critical, P1 = high, P2 = medium, P3 = low`;

/**
 * @param {Record<string, unknown>} t
 * @param {string} goal
 */
export function inferPlannerCapabilityType(t, goal) {
  const blob = `${t?.title || ''} ${t?.description || ''} ${goal || ''}`.toLowerCase();
  if (/\b(playwright|@playwright\/test|npx playwright|e2e test|smoke test|browser test)\b/.test(blob)) {
    return 'playwright_validation';
  }
  if (/\b(screenshot|browser capture|dom summary|console errors|page.goto|open in browser|render the page)\b/.test(blob)) {
    return 'browser_capture';
  }
  if (/\b(excalidraw|diagram|flowchart|wireframe|whiteboard|canvas sketch)\b/.test(blob)) {
    return 'excalidraw_diagram';
  }
  if (/\b(monaco|patch|refactor|edit file|typescript|react component|implement in)\b/.test(blob)) {
    return 'monaco_edit';
  }
  return 'general_agent';
}

/**
 * Normalize LLM task row for DB + executor (capability spine).
 * @param {Record<string, unknown>} t
 * @param {string} goal
 */
export function normalizePlannerTask(t, goal) {
  const out = { ...t };
  let cap = String(out.capability_type || '').trim().toLowerCase();
  if (!cap || cap === 'null') cap = inferPlannerCapabilityType(out, goal);
  out.capability_type = cap;

  const files = Array.isArray(out.files_involved) ? out.files_involved.map((x) => String(x).trim()).filter(Boolean) : [];
  out.files_involved = files;

  const routes = Array.isArray(out.routes_involved) ? out.routes_involved.map((x) => String(x).trim()).filter(Boolean) : [];
  out.routes_involved = routes;

  let ht = String(out.handler_type || 'agent').toLowerCase();
  if (cap === 'playwright_validation') {
    ht = 'terminal';
    out.handler_type = 'terminal';
    const ps = String(out.proposed_shell || '').trim();
    if (!ps) {
      out.proposed_shell = String(out.description || 'npx playwright test').slice(0, 4000);
    } else {
      out.proposed_shell = ps.slice(0, 4000);
    }
    out.requires_approval = true;
  } else if (cap === 'excalidraw_diagram') {
    if (ht === 'terminal' || ht === 'script') out.handler_type = 'agent';
    ht = String(out.handler_type || 'agent').toLowerCase();
  } else if (cap === 'browser_capture' || cap === 'monaco_edit') {
    if (ht === 'terminal') out.handler_type = 'agent';
  }

  const qg = {
    capability_type: cap,
    requires_approval: !!out.requires_approval,
    proposed_shell: out.proposed_shell != null ? String(out.proposed_shell).slice(0, 4000) : null,
  };
  out.quality_gate_json = JSON.stringify(qg);

  return out;
}

/**
 * @param {Record<string, unknown>} task
 * @returns {string}
 */
export function resolvePlanTaskCapabilityType(task) {
  try {
    const qg = JSON.parse(String(task.quality_gate_json || '{}'));
    if (qg.capability_type) return String(qg.capability_type).toLowerCase().trim();
  } catch {
    /* ignore */
  }
  const hk = String(task.handler_key || '');
  const m = hk.match(/^cap:([a-z0-9_]+)/i);
  if (m) return m[1].toLowerCase();
  return inferPlannerCapabilityType(task, '');
}

function planTaskNeedsRiskyApprovalFabric(t) {
  const ht = String(t.handler_type || 'agent').toLowerCase();
  const cat = String(t.category || '').toLowerCase();
  const cap = String(t.capability_type || '').toLowerCase();
  const blob = `${t.title || ''} ${t.description || ''}`.toLowerCase();
  if (cap === 'playwright_validation') return true;
  if (ht === 'script' && (cap === 'playwright_validation' || /\bplaywright\b/.test(blob))) return true;
  return ht === 'terminal' || ht === 'db_query' || cat === 'db' || cat === 'infra';
}

function shellPreviewForRiskyTask(t) {
  const ps = t.proposed_shell != null ? String(t.proposed_shell).trim() : '';
  if (ps) return ps.slice(0, 4000);
  const hk = t.handler_key != null ? String(t.handler_key).trim() : '';
  const desc = String(t.description || '').trim();
  if (hk.startsWith('cmd:')) return desc.slice(0, 4000);
  if (hk && /^[a-zA-Z0-9_.-]{4,80}$/.test(hk) && !/[;&|`$]/.test(hk)) {
    return desc.slice(0, 4000);
  }
  return (hk || desc).slice(0, 4000) || `[${String(t.handler_type || 'task')}] ${String(t.title || '').slice(0, 500)}`;
}

/**
 * Build the planning-domain write service from explicit owning-domain
 * dependencies. The planner itself contains no source-layer imports.
 */
export function createPlanService(deps = {}) {
  const {
    dispatchComplete,
    resolveModelForTask,
    resolveCanonicalUserId,
    pragmaTableInfo,
    createPlanExcalidrawArtifact,
    createPlanMarkdownArtifact,
    insertAgentsamPlanRow,
    compactExecutionStepJson,
    insertApprovalQueueRow,
  } = deps;

  /**
   * @param {any} env
   * @param {Set<string>} stepCols
   * @param {{ executionParentId: string | null, workflowRunId: string, nodeKey: string, nodeType: string, inputObj: Record<string, unknown> }} p
   */
  async function insertPlanExecutionStep(env, stepCols, p) {
  if (!stepCols?.size) return null;
  const sid = stepId();
  const hasExec = stepCols.has('execution_id');
  const hasWrun = stepCols.has('workflow_run_id');
  if (!hasExec && !hasWrun) return null;
  if (hasExec && !p.executionParentId) return null;

  const colNames = ['id'];
  const placeholders = ['?'];
  const binds = [sid];

  if (hasExec) {
    colNames.push('execution_id');
    placeholders.push('?');
    binds.push(p.executionParentId);
  }
  if (hasWrun) {
    colNames.push('workflow_run_id');
    placeholders.push('?');
    binds.push(p.workflowRunId);
  }
  colNames.push('node_key', 'node_type', 'status', 'input_json');
  placeholders.push('?', '?', '?', '?');
  let inputJson = '{}';
  try {
    inputJson = await compactExecutionStepJson(p.inputObj || {}, 'input_json');
  } catch {
    inputJson = JSON.stringify(p.inputObj || {}).slice(0, 8192);
  }
  binds.push(
    String(p.nodeKey || 'plan_task').slice(0, 500),
    String(p.nodeType || 'agent').slice(0, 120),
    'pending',
    inputJson,
  );
  if (stepCols.has('attempt')) {
    colNames.push('attempt');
    placeholders.push('?');
    binds.push(1);
  }
  if (stepCols.has('started_at')) {
    colNames.push('started_at');
    placeholders.push('?');
    binds.push(Math.floor(Date.now() / 1000));
  }

  await env.DB
    .prepare(`INSERT INTO agentsam_execution_steps (${colNames.join(', ')}) VALUES (${placeholders.join(', ')})`)
    .bind(...binds)
    .run();
  return sid;
  }

  async function createPlan(
  env,
  {
    goal,
    userId,
    workspaceId,
    tenantId,
    sessionId = null,
    workflowRunId = null,
    workflowExecutionId = null,
    ctx = null,
    planningSkillMarkdown = null,
  },
) {
  if (!env.DB) throw new Error('DB not available');
  if (!workflowRunId || String(workflowRunId).trim() === '') {
    throw new Error('createPlan requires workflowRunId (agent_chat_plan spine)');
  }
  const wrun = String(workflowRunId).trim();

  let parsed;
  try {
    const resolved = await resolveModelForTask(env, {
      mode: 'plan',
      route_key: 'planning',
      workspace_id:
        workspaceId != null && String(workspaceId).trim() !== '' ? String(workspaceId).trim() : null,
      require_tools: true,
    });
    if (!resolved?.model_key) {
      throw new Error('agentsam-planner: resolveModelForTask returned no model');
    }
    const modelKey = resolved.model_key;
    const skillBlock =
      planningSkillMarkdown != null && String(planningSkillMarkdown).trim()
        ? `\n\n## Planning skill (follow for task breakdown)\n${String(planningSkillMarkdown).trim().slice(0, 12000)}`
        : '';
    const result = await dispatchComplete(env, {
      modelKey,
      taskType: 'plan',
      systemPrompt: PLANNER_SYSTEM + skillBlock,
      messages: [{ role: 'user', content: String(goal).slice(0, 4000) }],
      options: { reasoningEffort: 'medium', verbosity: 'low' },
    });
    const text = result?.text || result?.output_text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    parsed = {
      plan_title: String(goal).slice(0, 80),
      tasks: [
        {
          title: 'Execute goal',
          description: String(goal),
          category: 'other',
          priority: 'P1',
          handler_type: 'agent',
          workflow_key: null,
          estimated_minutes: 10,
        },
      ],
    };
  }

  let tasks = Array.isArray(parsed.tasks) ? parsed.tasks.slice(0, 8) : [];
  if (!tasks.length) {
    tasks = [
      {
        title: 'Execute goal',
        description: String(goal),
        category: 'other',
        priority: 'P1',
        handler_type: 'agent',
        workflow_key: null,
        estimated_minutes: 10,
      },
    ];
  }
  if (tasks.length < 2) {
    tasks.push({
      title: 'Verify and document results',
      description: `Review outcomes for: ${String(goal).slice(0, 400)}`,
      category: 'other',
      priority: 'P2',
      handler_type: 'agent',
      workflow_key: null,
      estimated_minutes: 5,
    });
  }

  tasks = tasks.map((t) => normalizePlannerTask(t, goal));

  const validWrun = wrun;

  const pid = planId();
  const today = new Date().toISOString().slice(0, 10);
  const tid0 = tenantId || env?.TENANT_ID || '';
  const ws0 = workspaceId || '';
  const uidRaw = userId != null && String(userId).trim() !== '' ? String(userId).trim() : null;
  const canonicalUser = uidRaw ? await resolveCanonicalUserId(uidRaw, env) : null;
  if (uidRaw && !canonicalUser) {
    return { ok: false, error: 'auth_user_id_required' };
  }

  const executionParentId = workflowExecutionId != null && String(workflowExecutionId).trim()
    ? String(workflowExecutionId).trim()
    : null;

  await insertAgentsamPlanRow(
    env,
    {
      id: pid,
      tenant_id: tid0,
      workspace_id: ws0,
      session_id: sessionId,
      title: parsed.plan_title || String(goal).slice(0, 80),
      status: 'active',
      plan_type: 'feature',
      plan_date: today,
      tasks_total: tasks.length,
      tasks_done: 0,
      workflow_run_id: validWrun,
    },
    ctx,
  );

  const stepCols = await pragmaTableInfo(env.DB, 'agentsam_execution_steps');
  const planTaskCols = await pragmaTableInfo(env.DB, 'agentsam_plan_tasks');
  const insertedTasks = [];

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const tid = taskId();
    const nodeKey = `plan_task_${i}_${String(t.title || 'task')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .slice(0, 60)}`;

    const wfKey =
      t.workflow_key != null && String(t.workflow_key).trim() !== '' ? String(t.workflow_key).trim() : null;
    const cap = String(t.capability_type || 'general_agent').slice(0, 64);
    const hk = wfKey || `cap:${cap}`;
    const riskLevel =
      cap === 'playwright_validation' ? 'critical' : planTaskNeedsRiskyApprovalFabric(t) ? 'high' : 'low';
    const requiresApr = planTaskNeedsRiskyApprovalFabric(t) ? 1 : 0;

    const estepId = await insertPlanExecutionStep(env, stepCols, {
      executionParentId,
      workflowRunId: wrun,
      nodeKey,
      nodeType: String(t.handler_type || 'agent').slice(0, 120),
      inputObj: {
        plan_id: pid,
        task_id: tid,
        workflow_run_id: validWrun,
        plan_task_order: i,
        capability_type: cap,
        handler_type: t.handler_type || 'agent',
        handler_key: hk,
        title: String(t.title || '').slice(0, 200),
        description: String(t.description || '').slice(0, 4000),
        risk_level: riskLevel,
        requires_approval: requiresApr === 1,
        files_involved: Array.isArray(t.files_involved) ? t.files_involved : [],
        routes_involved: Array.isArray(t.routes_involved) ? t.routes_involved : [],
      },
    });

    let commandRunPk = null;
    let approvalPk = null;

    if (planTaskNeedsRiskyApprovalFabric(t) && canonicalUser && String(ws0).trim()) {
      const cmdPreview = shellPreviewForRiskyTask(t).trim() || '[risky_task]';
      commandRunPk = commandRunId();
      const intentCat =
        cap === 'playwright_validation'
          ? 'debug'
          : String(t.handler_type || '').toLowerCase() === 'terminal'
            ? 'misc'
            : String(t.handler_type || '').toLowerCase() === 'db_query' || String(t.category || '').toLowerCase() === 'db'
              ? 'db'
              : 'misc';
      const commandsJson = JSON.stringify([
        { proposed_shell: cmdPreview.slice(0, 4000), source: 'plan_bootstrap', plan_task_id: tid },
      ]);
      const cmdRisk = cap === 'playwright_validation' ? 'critical' : 'high';
      await env.DB
        .prepare(
          `INSERT INTO agentsam_command_run
          (id, tenant_id, workspace_id, user_id, session_id, conversation_id,
           user_input, normalized_intent, intent_category, model_id,
           commands_json, result_json, output_text, confidence_score,
           success, exit_code, duration_ms, input_tokens, output_tokens, cost_usd, error_message,
           selected_command_id, selected_command_slug, risk_level, requires_confirmation, approval_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          commandRunPk,
          tid0,
          String(ws0).trim(),
          canonicalUser,
          sessionId || null,
          null,
          String(t.title || 'Plan task').slice(0, 2000),
          'plan_bootstrap_risky',
          intentCat,
          null,
          commandsJson,
          '{}',
          null,
          null,
          0,
          null,
          null,
          0,
          0,
          0,
          null,
          null,
          null,
          cmdRisk,
          1,
          'pending_approval',
        )
        .run();

      approvalPk = approvalId();
      const inputJson = JSON.stringify({
        command_text: cmdPreview.slice(0, 4000),
        plan_task_id: tid,
        plan_id: pid,
        execution_step_id: estepId,
      });

      const toolNm = cap === 'playwright_validation' ? 'terminal.playwright_plan' : 'terminal.plan_bootstrap';
      await insertApprovalQueueRow(env, {
        id: approvalPk,
        tenant_id: tid0,
        workspace_id: String(ws0).trim(),
        user_id: canonicalUser,
        session_id: sessionId || null,
        plan_id: pid,
        workflow_run_id: wrun,
        command_run_id: commandRunPk,
        execution_step_id: estepId || undefined,
        tool_name: toolNm,
        action_summary: `Approve risky plan task: ${String(t.title || '').slice(0, 200)}`,
        input_json: inputJson,
        risk_level: cmdRisk,
        status: 'pending',
        expires_at: null,
      });

      if (estepId && approvalPk) {
        await env.DB
          .prepare(
            `UPDATE agentsam_execution_steps SET approval_id = ?, status = 'approval_pending', output_json = ? WHERE id = ?`,
          )
          .bind(
            approvalPk,
            JSON.stringify({
              gate_results_json: { approval_required: true, capability_type: cap },
              approval_required: true,
            }).slice(0, 16000),
            estepId,
          )
          .run();
      }
    }

    const insTaskCols = [
      'id',
      'plan_id',
      'tenant_id',
      'workspace_id',
      'order_index',
      'title',
      'description',
      'priority',
      'category',
      'status',
      'handler_type',
      'handler_key',
      'estimated_minutes',
    ];
    const insTaskBinds = [
      tid,
      pid,
      tid0,
      ws0,
      i,
      String(t.title || '').slice(0, 200),
      String(t.description || '').slice(0, 2000),
      t.priority || 'P1',
      t.category || 'other',
      'todo',
      t.handler_type || 'agent',
      hk,
      t.estimated_minutes || null,
    ];
    if (planTaskCols.has('files_involved')) {
      insTaskCols.push('files_involved');
      insTaskBinds.push(JSON.stringify(Array.isArray(t.files_involved) ? t.files_involved : []));
    }
    if (planTaskCols.has('routes_involved')) {
      insTaskCols.push('routes_involved');
      insTaskBinds.push(JSON.stringify(Array.isArray(t.routes_involved) ? t.routes_involved : []));
    }
    if (planTaskCols.has('quality_gate_json') && t.quality_gate_json) {
      insTaskCols.push('quality_gate_json');
      insTaskBinds.push(String(t.quality_gate_json).slice(0, 8000));
    }
    if (planTaskCols.has('risk_level')) {
      insTaskCols.push('risk_level');
      insTaskBinds.push(riskLevel);
    }
    if (planTaskCols.has('requires_approval')) {
      insTaskCols.push('requires_approval');
      insTaskBinds.push(requiresApr);
    }
    if (planTaskCols.has('workflow_run_id')) {
      insTaskCols.push('workflow_run_id');
      insTaskBinds.push(wrun);
    }
    if (planTaskCols.has('execution_step_id') && estepId) {
      insTaskCols.push('execution_step_id');
      insTaskBinds.push(estepId);
    }
    if (planTaskCols.has('command_run_id') && commandRunPk) {
      insTaskCols.push('command_run_id');
      insTaskBinds.push(commandRunPk);
    }
    if (planTaskCols.has('created_at')) {
      insTaskCols.push('created_at');
    }
    const phParts = insTaskCols.map((c) => (c === 'created_at' ? 'unixepoch()' : '?'));
    await env.DB
      .prepare(
        `INSERT INTO agentsam_plan_tasks (${insTaskCols.join(', ')}) VALUES (${phParts.join(', ')})`,
      )
      .bind(...insTaskBinds)
      .run();

    insertedTasks.push({
      id: tid,
      ...t,
      order_index: i,
      execution_step_id: estepId,
      workflow_run_id: validWrun,
      command_run_id: commandRunPk,
      approval_id: approvalPk,
      handler_key: hk,
      capability_type: cap,
    });
  }

  let visual_map = null;
  let visual_map_error = null;
  const uidForArt = canonicalUser || uidRaw;
  if (uidForArt && String(ws0).trim() && tasks.length >= 2) {
    try {
      const vm = await createPlanExcalidrawArtifact(
        env,
        {
          tenantId: tid0,
          workspaceId: String(ws0).trim(),
          userId: String(uidForArt),
          planId: pid,
        },
        ctx,
      );
      if (vm.skipped_r2) {
        visual_map = {
          skipped_r2: true,
          content_base64: vm.content_base64,
          user_message: vm.user_message,
        };
      } else {
        visual_map = {
          artifact_id: vm.artifact_id,
          r2_key: vm.r2_key,
          public_url: vm.public_url,
        };
      }
    } catch (e) {
      visual_map_error = e?.message != null ? String(e.message) : String(e);
    }
  }

  let plan_markdown = null;
  let plan_markdown_error = null;
  if (uidForArt && String(ws0).trim()) {
    try {
      const pm = await createPlanMarkdownArtifact(
        env,
        {
          tenantId: tid0,
          workspaceId: String(ws0).trim(),
          userId: String(uidForArt),
          planId: pid,
        },
        ctx,
      );
      if (pm.skipped_r2) {
        plan_markdown = {
          skipped_r2: true,
          content_base64: pm.content_base64,
          user_message: pm.user_message,
        };
      } else {
        plan_markdown = {
          artifact_id: pm.artifact_id,
          r2_key: pm.r2_key,
          public_url: pm.public_url,
        };
      }
    } catch (e) {
      plan_markdown_error = e?.message != null ? String(e.message) : String(e);
    }
  }

  return {
    plan_id: pid,
    plan_title: parsed.plan_title || String(goal).slice(0, 80),
    tasks: insertedTasks,
    workflow_run_id: validWrun,
    visual_map,
    ...(visual_map_error ? { visual_map_error } : {}),
    plan_markdown,
    ...(plan_markdown_error ? { plan_markdown_error } : {}),
  };
  }

  return { createPlan, insertPlanExecutionStep };
}
