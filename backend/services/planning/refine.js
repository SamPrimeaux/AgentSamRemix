/**
 * Refine or revert an existing agentsam_plans row (Cursor-style start-over / @plan refine).
 */

export function createPlanRefiner(deps = {}) {
  const {
    dispatchComplete,
    resolveModelForTask,
    pragmaTableInfo,
    createPlanMarkdownArtifact,
    normalizePlannerTask,
  } = deps;

  function taskId() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return 'task_' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  const REFINE_SYSTEM = `You are refining an existing software plan. Return ONLY valid JSON:
{
  "plan_title": "updated short title",
  "tasks": [
    {
      "title": "task title",
      "description": "what to do",
      "category": "backend|frontend|db|infra|ux|research|other",
      "priority": "P0|P1|P2|P3",
      "handler_type": "agent|terminal|db_query|mcp_tool|script",
      "workflow_key": null,
      "capability_type": "monaco_edit|excalidraw_diagram|browser_capture|playwright_validation|general_agent",
      "files_involved": [],
      "routes_involved": [],
      "proposed_shell": "",
      "requires_approval": true,
      "estimated_minutes": 5
    }
  ]
}
Preserve completed work where possible; replace or add tasks for the refinement request. 2-8 tasks.`;

/**
 * @param {any} env
 * @param {{
 *   planId: string,
 *   refinement: string,
 *   userId: string,
 *   tenantId: string,
 *   workspaceId: string,
 *   sessionId?: string|null,
 *   planningSkillMarkdown?: string,
 * }} input
 * @param {any} [ctx]
 */
  async function refineAgentsamPlan(env, input, ctx = null) {
  if (!env?.DB) throw new Error('DB not available');
  const planId = String(input.planId || '').trim();
  const refinement = String(input.refinement || '').trim();
  if (!planId) throw new Error('plan_id required');
  if (!refinement) throw new Error('refinement message required');

  const plan = await env.DB.prepare(`SELECT * FROM agentsam_plans WHERE id = ? LIMIT 1`)
    .bind(planId)
    .first();
  if (!plan?.id) throw new Error('plan not found');
  if (String(plan.tenant_id || '') !== String(input.tenantId || '').trim()) {
    throw new Error('plan tenant mismatch');
  }
  if (String(plan.workspace_id || '') !== String(input.workspaceId || '').trim()) {
    throw new Error('plan workspace mismatch');
  }

  const { results: existingTasks } = await env.DB.prepare(
    `SELECT * FROM agentsam_plan_tasks WHERE plan_id = ? ORDER BY order_index ASC`,
  )
    .bind(planId)
    .all();

  const doneTasks = (existingTasks || []).filter((t) => String(t.status) === 'done');
  const pendingTasks = (existingTasks || []).filter((t) =>
    ['todo', 'in_progress', 'blocked'].includes(String(t.status)),
  );

  const contextBlock = [
    `Plan title: ${plan.title}`,
    '',
    'Completed tasks:',
    ...doneTasks.map((t) => `- [done] ${t.title}: ${String(t.description || '').slice(0, 200)}`),
    '',
    'Pending/blocked tasks:',
    ...pendingTasks.map((t) => `- [${t.status}] ${t.title}: ${String(t.description || '').slice(0, 200)}`),
    '',
    `Refinement request: ${refinement}`,
  ].join('\n');

  const resolved = await resolveModelForTask(env, {
    task_type: 'plan',
    mode: 'agent',
    workspace_id: input.workspaceId,
    require_tools: true,
  });
  if (!resolved?.model_key) throw new Error('refine: resolveModelForTask returned no model');

  const skillMd = String(input.planningSkillMarkdown || '').trim();
  const skillBlock = skillMd
    ? `\n\n## Planning skill (follow for task breakdown)\n${skillMd.slice(0, 6000)}`
    : '';

  const result = await dispatchComplete(env, {
    modelKey: resolved.model_key,
    taskType: 'plan',
    systemPrompt: REFINE_SYSTEM + skillBlock,
    messages: [{ role: 'user', content: contextBlock.slice(0, 8000) }],
    options: { reasoningEffort: 'medium', verbosity: 'low' },
  });

  let parsed;
  try {
    const text = String(result?.text || result?.output_text || '').trim();
    const clean = text.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    throw new Error('refine_parse_failed');
  }

  let tasks = Array.isArray(parsed.tasks) ? parsed.tasks.slice(0, 8) : [];
  if (!tasks.length) throw new Error('refine_no_tasks');
  tasks = tasks.map((t) => normalizePlannerTask(t, refinement));

  for (const t of pendingTasks) {
    await env.DB.prepare(
      `UPDATE agentsam_plan_tasks SET status = 'skipped', output_summary = ?, completed_at = unixepoch() WHERE id = ?`,
    )
      .bind('Superseded by plan refinement', t.id)
      .run();
  }

  const planTaskCols = await pragmaTableInfo(env.DB, 'agentsam_plan_tasks');
  const startIndex = (existingTasks || []).length;
  const inserted = [];

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const tid = taskId();
    const cap = String(t.capability_type || 'general_agent').slice(0, 64);
    const wfKey =
      t.workflow_key != null && String(t.workflow_key).trim() !== '' ? String(t.workflow_key).trim() : null;
    const hk = wfKey || `cap:${cap}`;

    const cols = [
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
    const binds = [
      tid,
      planId,
      plan.tenant_id,
      plan.workspace_id,
      startIndex + i,
      String(t.title || '').slice(0, 200),
      String(t.description || '').slice(0, 2000),
      t.priority || 'P1',
      t.category || 'other',
      'todo',
      t.handler_type || 'agent',
      hk,
      t.estimated_minutes || null,
    ];
    if (planTaskCols.has('workflow_run_id') && plan.workflow_run_id) {
      cols.push('workflow_run_id');
      binds.push(plan.workflow_run_id);
    }
    const ph = cols.map((c) => '?').join(', ');
    await env.DB.prepare(`INSERT INTO agentsam_plan_tasks (${cols.join(', ')}) VALUES (${ph})`)
      .bind(...binds)
      .run();
    inserted.push({ id: tid, ...t, order_index: startIndex + i });
  }

  const newTitle = String(parsed.plan_title || plan.title || '').slice(0, 200);
  const tasksTotal = doneTasks.length + inserted.length;
  await env.DB.prepare(
    `UPDATE agentsam_plans SET title = ?, status = 'active', tasks_total = ?, tasks_blocked = 0, updated_at = unixepoch() WHERE id = ?`,
  )
    .bind(newTitle, tasksTotal, planId)
    .run();

  const planMarkdown = await createPlanMarkdownArtifact(
    env,
    {
      tenantId: String(plan.tenant_id),
      workspaceId: String(plan.workspace_id),
      userId: String(input.userId),
      planId,
      sourceSessionId: input.sessionId ?? null,
      sourceRunId: plan.workflow_run_id ?? null,
    },
    ctx,
  );

  return {
    plan_id: planId,
    plan_title: newTitle,
    task_count: inserted.length,
    tasks: inserted,
    plan_markdown: planMarkdown,
    refined: true,
  };
}

/**
 * Reset blocked/failed tasks to todo for re-execution (start over).
 * @param {any} env
 * @param {{ planId: string, tenantId: string, workspaceId: string }} input
 */
  async function revertAgentsamPlan(env, input) {
  if (!env?.DB) throw new Error('DB not available');
  const planId = String(input.planId || '').trim();
  if (!planId) throw new Error('plan_id required');

  const plan = await env.DB.prepare(`SELECT * FROM agentsam_plans WHERE id = ? LIMIT 1`)
    .bind(planId)
    .first();
  if (!plan?.id) throw new Error('plan not found');
  if (String(plan.tenant_id || '') !== String(input.tenantId || '').trim()) {
    throw new Error('plan tenant mismatch');
  }
  if (String(plan.workspace_id || '') !== String(input.workspaceId || '').trim()) {
    throw new Error('plan workspace mismatch');
  }

  await env.DB.prepare(
    `UPDATE agentsam_plan_tasks
        SET status = 'todo', error_trace = NULL, output_summary = NULL, completed_at = NULL
      WHERE plan_id = ? AND status IN ('blocked', 'in_progress')`,
  )
    .bind(planId)
    .run();

  await env.DB.prepare(
    `UPDATE agentsam_plans SET status = 'active', tasks_blocked = 0, updated_at = unixepoch() WHERE id = ?`,
  )
    .bind(planId)
    .run();

  const { results: tasks } = await env.DB.prepare(
    `SELECT id, title, status, order_index FROM agentsam_plan_tasks WHERE plan_id = ? ORDER BY order_index ASC`,
  )
    .bind(planId)
    .all();

  return { plan_id: planId, status: 'active', tasks: tasks || [], reverted: true };
  }

  return { refineAgentsamPlan, revertAgentsamPlan };
}
