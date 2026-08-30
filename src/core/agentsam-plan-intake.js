/**
 * Plan Mode intake — explore → batched questions → resume planning.
 * D1: agentsam_plan_intake_batches (SSOT for Q&A state).
 */

import { dispatchComplete } from '../../backend/agentsam/runtime/provider-dispatch.js';
import { resolveModelForTask } from './resolveModel.js';
import { retrieveContextPack } from '../../backend/rag/index.js';
import { searchCodebase } from './codebase-search.js';
import { pragmaTableInfo } from '../../backend/services/retention.js';

const BATCH_TTL_SEC = 60 * 60 * 24;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function newPlanIntakeBatchId() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return `pintake_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * @param {Array<{ id: string, question: string, options?: string[], multi_select?: boolean }>} raw
 */
export function formatPlanIntakeQuestionsForUi(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list.slice(0, 5).map((q, qi) => {
    const id = String(q?.id || `q${qi + 1}`).trim();
    const question = String(q?.question || '').trim();
    const opts = Array.isArray(q?.options) ? q.options.map((o) => String(o).trim()).filter(Boolean) : [];
    const choices = opts.slice(0, 9).map((label, i) => ({
      key: LETTERS[i] || String(i + 1),
      label,
    }));
    choices.push({ key: 'OTHER', label: 'Other…' });
    return { id, question, choices, multi_select: Boolean(q?.multi_select) };
  });
}

/**
 * @param {any} env
 * @param {{ goal: string, workspaceId: string, intent?: string }} opts
 */
export async function runPlanIntakeExplore(env, opts) {
  const goal = String(opts?.goal || '').trim();
  const workspaceId = String(opts?.workspaceId || '').trim();
  if (!goal || !workspaceId) {
    return {
      synthesis: '',
      files_searched: 0,
      searches: 0,
      findings: [],
      confidence: 'low',
    };
  }

  const pack = await retrieveContextPack(env, {
    query: goal,
    workspaceId,
    intent: opts?.intent || 'architecture',
    maxChunks: 8,
  }).catch(() => null);

  let codeHits = [];
  try {
    const code = await searchCodebase(env, goal, { workspaceId, topK: 8 });
    const vz = code?.vectorize?.hits || [];
    const pgRows = Array.isArray(code?.pg?.rows) ? code.pg.rows : [];
    if (vz.length) {
      codeHits = vz.slice(0, 8).map((h) => ({
        title: String(h?.metadata?.title || h?.metadata?.path || 'code').trim(),
        path: String(h?.metadata?.path || h?.metadata?.source_path || '').trim() || null,
        lane: 'codebase',
        snippet: String(h?.metadata?.content || h?.metadata?.snippet || '').slice(0, 280),
        score: Number(h?.score ?? 0),
      }));
    } else {
      codeHits = pgRows.slice(0, 8).map((row) => ({
        title: String(row?.file_path || 'code').trim(),
        path: String(row?.file_path || '').trim() || null,
        lane: 'codebase',
        snippet: String(row?.content || '').slice(0, 280),
        score: Number(row?.similarity ?? 0),
      }));
    }
  } catch {
    /* codebase lane optional */
  }

  const chunks = pack?.chunks || [];
  const ragFindings = chunks.slice(0, 6).map((c) => ({
    title: c.title,
    path: c.sourcePath || c.sourceRef || null,
    lane: c.lane,
    snippet: String(c.content || '').slice(0, 280),
  }));

  const seen = new Set();
  const findings = [];
  for (const f of [...codeHits, ...ragFindings]) {
    const key = `${f.path || ''}:${f.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(f);
    if (findings.length >= 12) break;
  }

  const uniquePaths = new Set(findings.map((f) => f.path).filter(Boolean));
  const searchCount =
    (pack?.diagnostics?.searchedLanes?.length || 0) + (codeHits.length ? 1 : 0);

  return {
    synthesis:
      findings.length > 0
        ? `Explored ${uniquePaths.size || findings.length} files/context hits (${searchCount} search lanes).`
        : 'No strong codebase matches — planning from your goal text.',
    files_searched: uniquePaths.size || findings.length,
    searches: searchCount,
    findings,
    steps: findings.slice(0, 6).map((f) => ({
      kind: 'file',
      label: f.path || f.title,
      lane: f.lane,
    })),
    confidence: pack?.diagnostics?.confidence || (findings.length ? 'medium' : 'low'),
  };
}

const INTAKE_QUESTIONS_SYSTEM = `You are Agent Sam's plan intake engine (Cursor-parity Plan Mode).
After light codebase exploration, prefer clarifying questions before writing an execution plan — same spirit as Cursor Plan Mode.
Return ONLY valid JSON:
{
  "needs_questions": true|false,
  "synthesis": "1-2 sentences on what you learned and what is still ambiguous",
  "questions": [
    {
      "id": "q1",
      "question": "Specific prioritized question with context",
      "options": ["option A", "option B", "option C"],
      "multi_select": false
    }
  ]
}
Rules:
- Default needs_questions=true when any of: multiple valid approaches, missing acceptance criteria, unclear scope, or touch ≥2 systems/files without named paths.
- needs_questions=false ONLY when the goal already names concrete paths/routes AND acceptance criteria AND a single obvious approach.
- Max 3 questions, 3-9 options each (worker adds "Other…"). Prefer trade-off questions (approach A vs B), scope boundaries, and success criteria.
- Set multi_select: true only if picking more than one option genuinely makes sense; otherwise false.
- Questions must reference the actual goal and exploration — never generic onboarding fluff.
- phase roadblock: focus on how to unblock (scope change, skip task, alternate approach).`;

/**
 * @param {any} env
 * @param {{
 *   goal: string,
 *   explore: Record<string, unknown>,
 *   phase?: string,
 *   roadblock?: Record<string, unknown>|null,
 *   userId?: string|null,
 * }} opts
 */
/** CMS plan intake — used when goal is tagged [CMS · slug]. */
export function cmsPlanIntakeSeedQuestions(projectSlug) {
  const slug = String(projectSlug || 'this site').trim();
  return [
    {
      id: 'cms_start',
      question: `How should we build CMS pages for **${slug}**?`,
      options: ['Start from cms_component_templates', 'Build from scratch in studio', 'Import existing R2/HTML'],
    },
    {
      id: 'cms_home',
      question: `What should be the homepage route for **${slug}**?`,
      options: ['/', '/home', 'Keep existing homepage from cms_pages'],
    },
    {
      id: 'cms_theme',
      question: `Which theme should we activate for **${slug}**?`,
      options: ['Use active cms_themes row', 'Clone inneranimalmedia theme', 'Define new theme slug'],
    },
  ];
}

/**
 * @param {string} goal
 */
export function isCmsPlanGoal(goal) {
  return /^\[CMS\b/i.test(String(goal || '').trim());
}

/**
 * @param {string} goal
 */
export function parseCmsSlugFromPlanGoal(goal) {
  const m = String(goal || '').match(/^\[CMS\s*[·•]\s*([^\]]+)\]/i);
  return m ? String(m[1]).trim() : null;
}

export async function generatePlanIntakeQuestions(env, opts) {
  const goal = String(opts?.goal || '').trim();
  const explore = opts?.explore || {};
  const phase = String(opts?.phase || 'pre_plan');
  const roadblock = opts?.roadblock || null;

  if (isCmsPlanGoal(goal)) {
    const slug = parseCmsSlugFromPlanGoal(goal) || 'site';
    const questions = cmsPlanIntakeSeedQuestions(slug);
    return {
      needs_questions: true,
      synthesis:
        explore.synthesis ||
        `CMS plan for ${slug} — clarify template vs scratch, homepage route, and theme before execution.`,
      questions,
    };
  }

  const findingLines = (Array.isArray(explore.findings) ? explore.findings : [])
    .slice(0, 5)
    .map((f) => `- ${f.title || 'hit'}${f.path ? ` (${f.path})` : ''}: ${String(f.snippet || '').slice(0, 120)}`)
    .join('\n');

  const userBlock = [
    `Goal: ${goal}`,
    `Phase: ${phase}`,
    explore.synthesis ? `Explore synthesis: ${explore.synthesis}` : '',
    findingLines ? `Findings:\n${findingLines}` : '',
    roadblock ? `Roadblock: ${JSON.stringify(roadblock).slice(0, 1200)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const resolved = await resolveModelForTask(env, {
    task_type: 'plan',
    mode: 'agent',
    workspace_id: opts?.workspaceId != null ? String(opts.workspaceId).trim() : null,
  });
  if (!resolved?.model_key) throw new Error('plan_intake: resolveModelForTask returned no model');

  const result = await dispatchComplete(env, {
    modelKey: resolved.model_key,
    taskType: 'plan',
    systemPrompt: INTAKE_QUESTIONS_SYSTEM,
    messages: [{ role: 'user', content: userBlock }],
    options: { reasoningEffort: 'low', verbosity: 'low' },
  });

  let parsed;
  let parseFailed = false;
  try {
    const text = String(result?.text || result?.output_text || '').replace(/```json|```/g, '').trim();
    parsed = JSON.parse(text);
  } catch {
    parseFailed = true;
    parsed = { needs_questions: true, synthesis: explore.synthesis || '', questions: [] };
  }

  let questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
  // Fail open toward Cursor-parity clarify: parse failure or empty question list still asks once.
  if ((parseFailed || parsed?.needs_questions === true) && questions.length === 0) {
    questions = [
      {
        id: 'q1',
        question: 'Which approach should this plan prioritize?',
        options: [
          'Smallest safe change that meets the goal',
          'Full end-to-end implementation',
          'Investigate + document only (no code changes yet)',
        ],
        multi_select: false,
      },
      {
        id: 'q2',
        question: 'What counts as done for this plan?',
        options: [
          'Code merged / deployed',
          'Local proof only (build / node --check / smoke)',
          'Written plan + task list — I will Build later',
        ],
        multi_select: false,
      },
    ];
  }

  const needs =
    parseFailed ||
    parsed?.needs_questions === true ||
    (questions.length > 0 && parsed?.needs_questions !== false);

  return {
    needs_questions: Boolean(needs && questions.length > 0),
    synthesis: String(parsed?.synthesis || explore.synthesis || '').trim(),
    questions: questions.slice(0, 3),
  };
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} row
 */
export async function insertPlanIntakeBatch(env, row) {
  if (!env?.DB) throw new Error('DB not available');
  const cols = await pragmaTableInfo(env.DB, 'agentsam_plan_intake_batches');
  if (!cols.size) throw new Error('agentsam_plan_intake_batches missing — run migration 563');

  const id = String(row.id || newPlanIntakeBatchId()).trim();
  const now = Math.floor(Date.now() / 1000);
  const bind = {
    id,
    tenant_id: String(row.tenant_id || '').trim(),
    workspace_id: String(row.workspace_id || '').trim(),
    user_id: row.user_id != null ? String(row.user_id).trim() : null,
    session_id: row.session_id != null ? String(row.session_id).trim() : null,
    phase: String(row.phase || 'pre_plan'),
    status: String(row.status || 'pending'),
    goal_text: String(row.goal_text || '').trim(),
    explore_summary_json: row.explore_summary_json != null ? String(row.explore_summary_json) : null,
    questions_json: row.questions_json != null ? String(row.questions_json) : '[]',
    answers_json: row.answers_json != null ? String(row.answers_json) : null,
    optional_details: row.optional_details != null ? String(row.optional_details) : null,
    plan_id: row.plan_id != null ? String(row.plan_id).trim() : null,
    workflow_run_id: row.workflow_run_id != null ? String(row.workflow_run_id).trim() : null,
    parent_batch_id: row.parent_batch_id != null ? String(row.parent_batch_id).trim() : null,
    roadblock_context_json: row.roadblock_context_json != null ? String(row.roadblock_context_json) : null,
    created_at: now,
    answered_at: row.answered_at != null ? Number(row.answered_at) : null,
    expires_at: now + BATCH_TTL_SEC,
  };

  const insertCols = Object.keys(bind).filter((k) => cols.has(k));
  const placeholders = insertCols.map(() => '?').join(', ');
  await env.DB.prepare(
    `INSERT INTO agentsam_plan_intake_batches (${insertCols.join(', ')}) VALUES (${placeholders})`,
  )
    .bind(...insertCols.map((k) => bind[k]))
    .run();

  return { id, ...bind };
}

/**
 * @param {any} env
 * @param {string} batchId
 */
export async function getPlanIntakeBatch(env, batchId) {
  const id = String(batchId || '').trim();
  if (!id || !env?.DB) return null;
  return env.DB.prepare(`SELECT * FROM agentsam_plan_intake_batches WHERE id = ? LIMIT 1`)
    .bind(id)
    .first()
    .catch(() => null);
}

/**
 * @param {any} env
 * @param {{ workspaceId: string, sessionId?: string|null, userId?: string|null }} scope
 */
export async function supersedePendingBatchesForSession(env, scope) {
  const ws = String(scope?.workspaceId || '').trim();
  if (!ws || !env?.DB) return;
  const sessionId = scope?.sessionId != null ? String(scope.sessionId).trim() : '';
  if (sessionId) {
    await env.DB.prepare(
      `UPDATE agentsam_plan_intake_batches SET status = 'superseded'
       WHERE workspace_id = ? AND session_id = ? AND status = 'pending'`,
    )
      .bind(ws, sessionId)
      .run()
      .catch(() => {});
  }
}

/**
 * @param {any} env
 * @param {string} batchId
 * @param {{
 *   selections?: Record<string, string>,
 *   optionalDetails?: string,
 *   skipped?: boolean,
 * }} submit
 */
export async function submitPlanIntakeBatch(env, batchId, submit) {
  const batch = await getPlanIntakeBatch(env, batchId);
  if (!batch?.id) return { ok: false, error: 'batch_not_found' };
  if (String(batch.status) !== 'pending') return { ok: false, error: 'batch_not_pending' };

  const now = Math.floor(Date.now() / 1000);
  const skipped = submit?.skipped === true;
  const answers = submit?.selections && typeof submit.selections === 'object' ? submit.selections : {};
  const optionalDetails = String(submit?.optionalDetails || '').trim();

  await env.DB.prepare(
    `UPDATE agentsam_plan_intake_batches
        SET status = ?, answers_json = ?, optional_details = ?, answered_at = ?
      WHERE id = ?`,
  )
    .bind(
      skipped ? 'skipped' : 'answered',
      JSON.stringify(answers),
      optionalDetails || null,
      now,
      batchId,
    )
    .run();

  return {
    ok: true,
    batch: {
      ...batch,
      status: skipped ? 'skipped' : 'answered',
      answers_json: JSON.stringify(answers),
      optional_details: optionalDetails || null,
      answered_at: now,
    },
  };
}

/**
 * Build enriched goal string for createPlan from batch + answers.
 * @param {Record<string, unknown>} batch
 */
export function buildEnrichedGoalFromIntakeBatch(batch) {
  const goal = String(batch?.goal_text || '').trim();
  let questions = [];
  let answers = {};
  try {
    questions = JSON.parse(String(batch?.questions_json || '[]'));
  } catch {
    questions = [];
  }
  try {
    answers = JSON.parse(String(batch?.answers_json || '{}'));
  } catch {
    answers = {};
  }
  const optional = String(batch?.optional_details || '').trim();
  const lines = [goal];
  if (questions.length && Object.keys(answers).length) {
    lines.push('', 'User clarifications:');
    for (const q of questions) {
      const qid = String(q?.id || '').trim();
      const ans = answers[qid];
      if (!qid || !ans) continue;
      lines.push(`- ${String(q?.question || qid)} → ${ans}`);
    }
  }
  if (optional) lines.push('', `Additional details: ${optional}`);
  let explore;
  try {
    explore = JSON.parse(String(batch?.explore_summary_json || '{}'));
  } catch {
    explore = null;
  }
  if (explore?.synthesis) lines.push('', `Explore notes: ${explore.synthesis}`);
  return lines.join('\n').trim();
}
