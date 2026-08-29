/**
 * eval-runner.js
 * Autonomous eval suite runner — triggered after N arm executions.
 * Writes to agentsam_eval_runs, then feeds score_overall back to
 * scheduleRoutingArmQualityUpdate to close the Thompson feedback loop.
 */
import { scheduleRoutingArmQualityUpdate } from '../../backend/agentsam/runtime/routing/routing.js';
import { applyEtoToRoutingArms, scheduleEtoFromEvalRun } from '../../backend/http/agentsam/routes/ops-runtime.js';
import { completeWithOpenAIResponsesNonStream } from '../integrations/openai.js';

/**
 * Trigger eval suite for a given arm after milestone execution count.
 * Called from recordArmOutcome when total_executions % EVAL_EVERY === 0.
 */
export async function triggerEvalAfterNRuns(env, ctx, { armId, taskType, mode, modelKey, workspaceId, routeKey }) {
  if (!env?.DB || !armId) return;

  try {
    const arm = await env.DB.prepare(
      'SELECT total_executions, model_key, task_type, mode FROM agentsam_routing_arms WHERE id = ? LIMIT 1'
    ).bind(armId).first();

    if (!arm) return;

    const totalExec = Number(arm.total_executions);
    const EVAL_EVERY = totalExec < 20 ? 5 : totalExec < 100 ? 10 : 50;
    if (totalExec % EVAL_EVERY !== 0) return;

    const mk    = modelKey ?? arm.model_key;
    const tt    = taskType ?? arm.task_type ?? 'chat';
    const md    = mode ?? arm.mode ?? 'auto';

    // Find matching active suite
    const suite = await env.DB.prepare(
      `SELECT id, name FROM agentsam_eval_suites
       WHERE task_type = ? AND is_active = 1
       ORDER BY run_count ASC LIMIT 1`
    ).bind(tt).first();

    if (!suite) return;

    // Pull eval cases for this suite
    const { results: cases } = await env.DB.prepare(
      'SELECT id, input_prompt, expected_output, grading_criteria FROM agentsam_eval_cases WHERE suite_id = ? ORDER BY sort_order ASC LIMIT 5'
    ).bind(suite.id).all();

    if (!cases?.length) return;

    const runId = 'evr_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    const scores = [];

    for (const c of cases) {
      const t0 = Date.now();
      let outputText = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let passed = 0;
      let scoreQuality = 0.5;
      let graderOutputText = '';

      try {
        // Resolve cheapest capable grader model from catalog (prefer gpt-5.4-nano → gpt-5.4-mini)
        const graderRow = await env.DB?.prepare(
          `SELECT model_key, api_platform
           FROM agentsam_model_catalog
           WHERE model_key IN ('gpt-5.4-nano', 'gpt-5.4-mini')
             AND is_active = 1 AND is_degraded = 0 AND budget_exhausted = 0
           ORDER BY cost_per_1k_out ASC LIMIT 1`
        ).first().catch(() => null);

        if (graderRow?.model_key) {
          const graderPrompt = [
            `You are an eval grader. Score this AI response 0.0–1.0.`,
            `CRITERIA: ${c.grading_criteria ?? 'general quality and accuracy'}`,
            `EXPECTED OUTPUT: ${c.expected_output ?? 'n/a'}`,
            `INPUT PROMPT: ${c.input_prompt}`,
            `ACTUAL RESPONSE: ${outputText?.slice(0, 2000) ?? '(no output)'}`,
            `Respond ONLY with a JSON object: {"score": 0.0-1.0, "passed": true/false, "notes": "brief reason"}`,
          ].join('\n');

          const graderResult = await completeWithOpenAIResponsesNonStream(env, {
            modelKey: graderRow.model_key,
            messages: [{ role: 'user', content: graderPrompt }],
            systemPrompt: 'You are a precise eval grader. Respond only with valid JSON.',
            tools: [],
            options: { response_format: { type: 'json_object' } },
          });

          const rawText = graderResult?.content?.[0]?.text
            ?? graderResult?.text
            ?? graderResult?.output?.[0]?.content?.[0]?.text
            ?? '';

          try {
            const clean = rawText.replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(clean);
            scoreQuality = Math.min(1, Math.max(0, Number(parsed.score ?? 0.5)));
            passed = parsed.passed === true ? 1 : 0;
            graderOutputText = String(parsed.notes ?? '').slice(0, 500);
          } catch {
            // JSON parse failed — use neutral score
            scoreQuality = 0.5;
            passed = 0;
          }
        } else {
          // No grader model available — skip with neutral score
          scoreQuality = 0.5;
          passed = 0;
        }
      } catch (e) {
        scoreQuality = 0.0;
        passed = 0;
      }

      scores.push(scoreQuality);

      // Write eval_run row
      const cols = await env.DB.prepare("PRAGMA table_info(agentsam_eval_runs)").all()
        .then(r => new Set(r.results.map(c => c.name)));

      const colList = ['id', 'suite_id', 'tenant_id', 'model_key', 'provider', 'score_quality', 'score_overall', 'passed', 'latency_ms', 'run_group_id'];
      const colListFiltered = colList.filter(c => cols.has(c));
      const provider = mk.startsWith('claude') ? 'anthropic' : mk.startsWith('gpt') ? 'openai' : 'unknown';

      const evalRunRowId = runId + '_' + c.id.slice(-4);
      await env.DB.prepare(
        `INSERT INTO agentsam_eval_runs (${colListFiltered.join(', ')}) VALUES (${colListFiltered.map(() => '?').join(', ')})`
      ).bind(
        evalRunRowId,
        suite.id,
        workspaceId ?? '',
        mk,
        provider,
        scoreQuality,
        scoreQuality,
        passed,
        Date.now() - t0,
        armId,
      ).run().catch(e => console.warn('[eval-runner] insert', e?.message));

      if (ctx?.waitUntil) {
        const slo = await env.DB.prepare(
          `SELECT sla_min_quality FROM agentsam_task_slos WHERE task_type = ? LIMIT 1`,
        )
          .bind(tt)
          .first()
          .catch(() => null);
        const minQ = slo?.sla_min_quality != null ? Number(slo.sla_min_quality) : null;
        const slaBreach =
          minQ != null && Number.isFinite(minQ) && Number.isFinite(scoreQuality) && scoreQuality < minQ;

        let resolvedWorkspaceId =
          workspaceId != null && String(workspaceId).trim() !== '' ? String(workspaceId).trim() : '';
        let tenantId = null;
        if (resolvedWorkspaceId) {
          const ws = await env.DB.prepare(
            `SELECT tenant_id FROM agentsam_workspace WHERE id = ? LIMIT 1`,
          )
            .bind(resolvedWorkspaceId)
            .first()
            .catch(() => null);
          tenantId = ws?.tenant_id != null ? String(ws.tenant_id) : null;
        } else {
          const ws = await env.DB.prepare(
            `SELECT id, tenant_id FROM agentsam_workspace ORDER BY id LIMIT 1`,
          )
            .first()
            .catch(() => null);
          resolvedWorkspaceId = ws?.id != null ? String(ws.id) : '';
          tenantId = ws?.tenant_id != null ? String(ws.tenant_id) : null;
        }

        scheduleEtoFromEvalRun(env, ctx, {
          evalRunId: evalRunRowId,
          tenantId,
          workspaceId: resolvedWorkspaceId || null,
          suiteId: suite.id,
          caseId: c.id,
          modelKey: mk,
          provider,
          taskType: tt,
          mode: md,
          routingArmId: armId,
          runGroupId: armId,
          passed,
          scoreOverall: scoreQuality,
          scoreQuality,
          latencyMs: Date.now() - t0,
          slaBreach,
        });
      }
    }

    // Average score across cases → feed back to Thompson
    const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

    if (avgScore != null && ctx?.waitUntil) {
      scheduleRoutingArmQualityUpdate(env, ctx, {
        taskType: tt,
        routeKey,
        mode: md,
        modelKey: mk,
        workspaceId: workspaceId ?? '',
        qualityScore: avgScore,
      });

      // Update suite run count
      ctx.waitUntil(
        env.DB.prepare(`UPDATE agentsam_eval_suites SET run_count = run_count + 1, last_run_at = datetime('now') WHERE id = ?`)
          .bind(suite.id).run().catch(() => {})
      );
    }

    console.log(`[eval-runner] suite=${suite.name} arm=${armId} cases=${cases.length} avgScore=${avgScore?.toFixed(3)}`);

    if (ctx?.waitUntil && env?.DB) {
      ctx.waitUntil(
        applyEtoToRoutingArms(env, {})
          .then((applied) => {
            const n = Number(applied?.armsUpdated) || 0;
            if (n > 0) {
              console.log(
                '[eval-runner] applyEtoToRoutingArms',
                JSON.stringify({ armId, suite: suite.name, ...applied }),
              );
            } else {
              console.warn(
                '[eval-runner] applyEtoToRoutingArms no_arms_updated',
                JSON.stringify({ armId, suite: suite.name, ...applied }),
              );
            }
          })
          .catch((e) => console.warn('[eval-runner] applyEtoToRoutingArms', e?.message ?? e)),
      );
    }
  } catch (e) {
    console.warn('[eval-runner] failed', e?.message ?? e);
  }
}
