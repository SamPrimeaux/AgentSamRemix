/**
 * Agent Sam studio intake: structured questions + plan steps (Anthropic).
 */
import { getAuthUser, jsonResponse, fetchAuthUserTenantId, fallbackSystemTenantId } from '../core/auth.js';
import { insertAgentsamPlanRow } from '../core/agentsam-plan-insert.js';

function resolveWorkspaceIdForPlan(env, authUser, body) {
  return (body?.workspace_id || body?.workspaceId || authUser?.workspace_id || env?.WORKSPACE_ID || '').toString().trim();
}

export async function handleIntakeApi(request, url, env, ctx) {
  const method = request.method.toUpperCase();
  const path = url.pathname.toLowerCase();

  try {
    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse({ error: 'ANTHROPIC_API_KEY not configured' }, 503);
    }

    // POST /api/agent/intake/start
    if (path === '/api/agent/intake/start' && method === 'POST') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

      const body = await request.json().catch(() => ({}));
      const goal = String(body.goal || '').trim();
      if (!goal) return jsonResponse({ error: 'goal is required' }, 400);
      const wsId = resolveWorkspaceIdForPlan(env, authUser, body);
      if (!wsId) return jsonResponse({ error: 'workspace_id required (or configure WORKSPACE_ID)' }, 400);

      const planId = 'plan_studio_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

      const systemPrompt = `You are Agent Sam's intake engine for a creative studio IDE.
Analyze the user's goal and return a structured JSON object — nothing else.
Return ONLY valid JSON matching this exact schema:
{
  "plan_id": "${planId}",
  "goal": "<restate goal concisely>",
  "goal_type": "<one of: web_app|cad_model|image|content|deploy|refactor|other>",
  "questions": [
    { "id": "q1", "question": "<specific question>", "options": ["<opt1>","<opt2>","<opt3>"] }
  ],
  "risk_flags": ["<risk if any>"]
}
Rules:
- Max 4 questions, 3-4 options each
- Questions must be specific to THIS goal, not generic
- risk_flags: only real risks (destructive ops, billing, overwrites) — empty array if none
- No markdown, no explanation, pure JSON only`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: `Goal: ${goal}${body.context ? '\nContext: ' + body.context : ''}` }],
          output_config: {
            format: {
              type: 'json_schema',
              schema: {
                type: 'object',
                properties: {
                  plan_id: { type: 'string' },
                  goal: { type: 'string' },
                  goal_type: { type: 'string', enum: ['web_app', 'cad_model', 'image', 'content', 'deploy', 'refactor', 'other'] },
                  questions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        question: { type: 'string' },
                        options: { type: 'array', items: { type: 'string' } },
                      },
                      required: ['id', 'question', 'options'],
                      additionalProperties: false,
                    },
                  },
                  risk_flags: { type: 'array', items: { type: 'string' } },
                },
                required: ['plan_id', 'goal', 'goal_type', 'questions', 'risk_flags'],
                additionalProperties: false,
              },
            },
          },
        }),
      });

      if (!aiRes.ok) {
        const err = await aiRes.text();
        console.warn('[intake/start] Anthropic error:', err.slice(0, 200));
        return jsonResponse({ error: 'AI service error' }, 502);
      }

      const aiData = await aiRes.json();
      let parsed;
      try {
        const raw = aiData.content?.[0]?.text || '{}';
        parsed = JSON.parse(raw);
      } catch {
        return jsonResponse({ error: 'Failed to parse AI response' }, 500);
      }

      if (!env.DB) {
        return jsonResponse({ error: 'Database not configured' }, 503);
      }

      let tenantId =
        authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
          ? String(authUser.tenant_id).trim()
          : null;
      if (!tenantId) tenantId = await fetchAuthUserTenantId(env, authUser.id);
      if (!tenantId) tenantId = fallbackSystemTenantId(env);

      await insertAgentsamPlanRow(
        env,
        {
          id: planId,
          tenant_id: tenantId,
          workspace_id: wsId,
          title: goal.slice(0, 120),
          plan_type: 'feature',
          status: 'active',
          plan_date: new Date().toISOString().slice(0, 10),
          morning_brief: JSON.stringify({
            questions: parsed.questions,
            goal_type: parsed.goal_type,
            risk_flags: parsed.risk_flags,
          }),
          default_model: 'claude-haiku-4-5-20251001',
          tasks_total: 0,
          tasks_done: 0,
        },
        ctx,
      );

      return jsonResponse({
        plan_id: planId,
        goal: parsed.goal,
        goal_type: parsed.goal_type,
        questions: parsed.questions,
        risk_flags: parsed.risk_flags,
      });
    }

    // POST /api/agent/intake/answer
    if (path === '/api/agent/intake/answer' && method === 'POST') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

      const body = await request.json().catch(() => ({}));
      const { plan_id, answers } = body;
      if (!plan_id) return jsonResponse({ error: 'plan_id required' }, 400);

      if (!env.DB) {
        return jsonResponse({ error: 'Database not configured' }, 503);
      }

      const plan = await env.DB.prepare('SELECT * FROM agentsam_plans WHERE id = ?').bind(plan_id).first();
      if (!plan) return jsonResponse({ error: 'Plan not found' }, 404);

      const brief = (() => {
        try {
          return JSON.parse(plan.morning_brief || '{}');
        } catch {
          return {};
        }
      })();

      const systemPrompt = `You are Agent Sam's planning engine.
Given a studio session goal and the user's answers, generate a precise build plan.
Return ONLY valid JSON matching this schema exactly:
{
  "steps": [
    {
      "id": "step_<short_id>",
      "title": "<action title under 60 chars>",
      "tool": "<one of: code|terminal|browser|r2|d1|github|meshy|openscad|blender|deploy|agent>",
      "estimated_ms": <number>,
      "requires_approval": <true|false>
    }
  ],
  "tools_required": ["<tool names>"],
  "estimated_cost_usd": <number>,
  "model_recommendation": "<model key>"
}
Rules:
- 3-8 steps only, ordered by dependency
- requires_approval=true for: deploys, DB writes, file deletes, billing, email sends
- estimated_ms realistic (code=5000, deploy=30000, CAD=60000)
- estimated_cost_usd: sum of all expected AI calls (typically 0.001-0.05)
- No markdown, pure JSON only`;

      const userContent = `Goal: ${plan.title}
Goal type: ${brief.goal_type || 'unknown'}
User answers: ${JSON.stringify(answers)}`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
          output_config: {
            format: {
              type: 'json_schema',
              schema: {
                type: 'object',
                properties: {
                  steps: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        title: { type: 'string' },
                        tool: { type: 'string' },
                        estimated_ms: { type: 'number' },
                        requires_approval: { type: 'boolean' },
                      },
                      required: ['id', 'title', 'tool', 'estimated_ms', 'requires_approval'],
                      additionalProperties: false,
                    },
                  },
                  tools_required: { type: 'array', items: { type: 'string' } },
                  estimated_cost_usd: { type: 'number' },
                  model_recommendation: { type: 'string' },
                },
                required: ['steps', 'tools_required', 'estimated_cost_usd', 'model_recommendation'],
                additionalProperties: false,
              },
            },
          },
        }),
      });

      if (!aiRes.ok) return jsonResponse({ error: 'AI service error' }, 502);

      const aiData = await aiRes.json();
      let planData;
      try {
        planData = JSON.parse(aiData.content?.[0]?.text || '{}');
      } catch {
        return jsonResponse({ error: 'Failed to parse plan' }, 500);
      }

      let todoTenantId =
        authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
          ? String(authUser.tenant_id).trim()
          : null;
      if (!todoTenantId) todoTenantId = await fetchAuthUserTenantId(env, authUser.id);
      if (!todoTenantId) todoTenantId = fallbackSystemTenantId(env);

      const insertStmts = (planData.steps || []).map((step, i) =>
        env.DB.prepare(`
          INSERT INTO agentsam_todo
            (id, tenant_id, title, task_type, execution_status, plan_id,
             requires_approval, category, created_by, project_key, sort_order,
             created_at, updated_at)
          VALUES (?, ?, ?, 'execute', 'queued', ?,
                  ?, 'studio', 'agentsam', 'studio', ?, datetime('now'), datetime('now'))
        `).bind(
          'todo_studio_' + crypto.randomUUID().replace(/-/g, '').slice(0, 8),
          todoTenantId,
          step.title,
          plan_id,
          step.requires_approval ? 1 : 0,
          i * 10,
        ),
      );

      if (insertStmts.length > 0) {
        await env.DB.batch(insertStmts);
      }

      await env.DB.prepare(`
        UPDATE agentsam_plans
        SET session_notes = ?, tasks_total = ?, updated_at = unixepoch()
        WHERE id = ?
      `).bind(JSON.stringify(planData), planData.steps?.length || 0, plan_id).run();

      return jsonResponse({
        plan_id,
        steps: planData.steps,
        tools_required: planData.tools_required,
        estimated_cost_usd: planData.estimated_cost_usd,
      });
    }

    // GET /api/agent/intake/:planId
    const intakeMatch = url.pathname.match(/^\/api\/agent\/intake\/([^/]+)$/i);
    if (intakeMatch && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

      if (!env.DB) {
        return jsonResponse({ error: 'Database not configured' }, 503);
      }

      const planId = intakeMatch[1];
      const plan = await env.DB.prepare('SELECT * FROM agentsam_plans WHERE id = ?').bind(planId).first();
      if (!plan) return jsonResponse({ error: 'Not found' }, 404);

      const { results: steps } = await env.DB.prepare(
        'SELECT * FROM agentsam_todo WHERE plan_id = ? ORDER BY sort_order',
      ).bind(planId).all();

      return jsonResponse({
        plan,
        steps: steps || [],
        budget: { cost_usd: plan.cost_usd, tokens_used: plan.tokens_used, token_budget: plan.token_budget },
      });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (e) {
    console.warn('[handleIntakeApi]', e?.message ?? e);
    return jsonResponse({ error: String(e?.message || e) }, 500);
  }
}
