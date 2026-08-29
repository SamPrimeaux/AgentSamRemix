/**
 * Turn decision — mode + explicit UI pins only.
 * No taskType classifier. No TaskSpec fiction (code.mutate.*). matchedBy is inert telemetry.
 */
import { buildTaskSpec, taskSpecKey } from './task-spec.js';

/**
 * @param {object} partial
 * @param {import('./task-spec.js').TaskSpec} taskSpec
 */
function withTaskSpec(partial, taskSpec) {
  return {
    ...partial,
    taskSpec,
    /** @deprecated Prefer mode — taskType is null on free-text turns */
    taskType: taskSpec.taskType,
  };
}

/**
 * Thin result shape for legacy consumers — mode only, no invented taskType.
 * @param {string} mode
 * @param {{ confidence?: number, matchedBy?: string|null, escalated?: boolean, taskType?: string|null }} [extra]
 */
function modeOnlyClassifyResult(mode, extra = {}) {
  const m = mode || 'agent';
  return {
    taskType: extra.taskType ?? null,
    mode: m,
    confidence: extra.confidence ?? 1,
    matchedBy: extra.matchedBy ?? 'mode',
    escalated: extra.escalated === true,
    intent: null,
  };
}

/**
 * @param {unknown} env
 * @param {Record<string, unknown>} row
 */
async function logTurnDecision(env, row) {
  if (!env?.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO agentsam_intent_decisions (
         id, tenant_id, workspace_id, user_id, conversation_id, task_type,
         message_excerpt, matched_by, is_match, confidence, model_key, provider,
         routing_arm_id, reason, latency_ms, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`,
    )
      .bind(
        row.id,
        row.tenant_id ?? null,
        row.workspace_id ?? null,
        row.user_id ?? null,
        row.conversation_id ?? null,
        row.task_type,
        row.message_excerpt != null ? String(row.message_excerpt).slice(0, 280) : null,
        row.matched_by,
        row.is_match ? 1 : 0,
        row.confidence ?? null,
        row.model_key ?? null,
        row.provider ?? null,
        row.routing_arm_id ?? null,
        row.reason != null ? String(row.reason).slice(0, 500) : null,
        row.latency_ms ?? null,
        JSON.stringify(row.metadata || {}).slice(0, 2000),
      )
      .run();
  } catch (e) {
    console.warn('[turn-decision] log failed', e?.message ?? e);
  }
}

/**
 * Mode-only front door. Image fast path only for explicit composer_action / forceImage.
 * @param {unknown} env
 * @param {string} message
 * @param {{
 *   tenantId?: string|null,
 *   workspaceId?: string|null,
 *   userId?: string|null,
 *   conversationId?: string|null,
 *   mode?: string|null,
 * }} [ctx]
 * @param {{
 *   forceImage?: boolean,
 *   composerAction?: string|null,
 *   skipChatEscalate?: boolean,
 *   skipLlmClassify?: boolean,
 * }} [opts]
 */
export async function resolveTurnDecision(env, message, ctx = {}, opts = {}) {
  const t0 = Date.now();
  const decisionId = `idc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const m = String(message || '').trim();
  const modeRaw = String(ctx.mode || opts.mode || 'agent').trim().toLowerCase() || 'agent';
  const mode = modeRaw === 'auto' ? 'agent' : modeRaw;

  const baseLog = {
    id: decisionId,
    tenant_id: ctx.tenantId ?? null,
    workspace_id: ctx.workspaceId ?? null,
    user_id: ctx.userId ?? null,
    conversation_id: ctx.conversationId ?? null,
    message_excerpt: m.slice(0, 280),
  };

  const forceImage =
    opts.forceImage === true ||
    String(opts.composerAction || '').trim().toLowerCase() === 'create_image';

  if (forceImage) {
    const chatResult = modeOnlyClassifyResult('agent', {
      confidence: 1,
      matchedBy: 'composer_action',
      taskType: 'image_generation',
    });
    const taskSpec = buildTaskSpec({
      taskType: 'image_generation',
      imageFastPath: true,
      mode: 'agent',
      confidence: 1,
      matchedBy: 'composer_action',
    });
    await logTurnDecision(env, {
      ...baseLog,
      task_type: 'image_generation',
      matched_by: 'composer_action',
      is_match: true,
      confidence: 1,
      reason: 'composer_force_image',
      latency_ms: Date.now() - t0,
      metadata: {
        spine: 'turn-decision-mode-only',
        imageFastPath: true,
        mode: 'agent',
        taskSpecKey: taskSpecKey(taskSpec),
      },
    });
    return withTaskSpec(
      {
        decisionId,
        imageFastPath: true,
        imageIntent: { isMatch: true, matchedBy: 'composer_action' },
        chatResult,
        matchedBy: 'composer_action',
        confidence: 1,
        escalated: false,
        mode: 'agent',
      },
      taskSpec,
    );
  }

  // Free-text: mode only. No taskType. No domain.operation.toolProfile fiction.
  const chatResult = modeOnlyClassifyResult(mode, {
    confidence: 1,
    matchedBy: 'mode',
    taskType: null,
  });
  const taskSpec = buildTaskSpec({
    taskType: null,
    imageFastPath: false,
    mode,
    confidence: 1,
    matchedBy: 'mode',
  });

  await logTurnDecision(env, {
    ...baseLog,
    // Persist mode in task_type column for legacy readers; not a classifier label.
    task_type: mode,
    matched_by: 'mode',
    is_match: 1,
    confidence: 1,
    reason: 'mode_only',
    latency_ms: Date.now() - t0,
    metadata: {
      spine: 'turn-decision-mode-only',
      imageFastPath: false,
      mode,
      taskSpecKey: taskSpecKey(taskSpec),
      taskType: null,
    },
  });

  console.info(
    '[turn-decision]',
    JSON.stringify({
      decisionId,
      imageFastPath: false,
      mode,
      taskSpecKey: taskSpecKey(taskSpec),
      matchedBy: 'mode',
    }),
  );

  return withTaskSpec(
    {
      decisionId,
      imageFastPath: false,
      imageIntent: { isMatch: false, matchedBy: 'mode', reason: 'mode_only' },
      chatResult,
      intent: null,
      mode,
      matchedBy: 'mode',
      confidence: 1,
      escalated: false,
    },
    taskSpec,
  );
}
