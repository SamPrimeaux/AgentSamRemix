/** Source-free SSE transport for plan refinement. */

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'Access-Control-Allow-Origin': '*',
};

function buildPlanSummaryText(plan, goal) {
  const title = String(plan?.plan_title || '').trim();
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const hint = tasks.slice(0, 3).map((task) => String(task?.title || '').trim()).filter(Boolean).join('; ');
  if (title && hint) return `${title} — ${hint}${tasks.length > 3 ? '…' : ''}`;
  return title || String(goal || 'Plan').slice(0, 240);
}

export function startPlanRefineSseResponse(env, ctx, input = {}, services = {}) {
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const emit = (type, payload) => {
    try {
      writer.write(encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`));
    } catch {
      /* disconnected client */
    }
  };
  (async () => {
    try {
      emit('plan_thinking', { message: 'Refining plan…' });
      const out = await services.refineAgentsamPlan(env, {
        planId: String(input.planId || ''),
        refinement: String(input.refinement || ''),
        userId: String(input.userId || ''),
        tenantId: String(input.tenantId || ''),
        workspaceId: String(input.workspaceId || ''),
        sessionId: input.sessionId != null ? String(input.sessionId) : null,
        planningSkillMarkdown: String(input.planningSkillMarkdown || ''),
      }, ctx);
      const r2Url = out.plan_markdown?.public_url ? String(out.plan_markdown.public_url).trim() : '';
      if (r2Url) {
        emit('monaco_file_generated', {
          type: 'monaco_file_generated',
          surface: 'monaco',
          plan_id: out.plan_id,
          filename: `plan-${out.plan_id}.md`,
          path: services.planLocalRelPath(out.plan_id),
          language: 'markdown',
          r2_url: r2Url,
        });
      }
      const summary = buildPlanSummaryText(out, String(input.refinement || ''));
      emit('plan_created', {
        plan_id: out.plan_id,
        plan_title: out.plan_title,
        task_count: out.task_count,
        auto_execute: false,
        summary,
        refined: true,
        plan_markdown: out.plan_markdown ?? null,
      });
      emit('text', { text: `**Plan refined** — ${summary}. Review in Monaco, then **Run plan** when ready.` });
      await input.planningRun?.complete({ status: 'completed' });
      emit('done', {});
    } catch (error) {
      await input.planningRun?.fail(error).catch(() => {});
      emit('text', { text: `**Plan refine error:** ${error?.message ?? String(error)}` });
      emit('done', {});
    } finally {
      writer.close().catch(() => {});
    }
  })();
  return new Response(readable, { headers: SSE_HEADERS });
}
