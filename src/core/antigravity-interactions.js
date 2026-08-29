/**
 * Google Antigravity — Interactions API executor.
 * Selection: ordinary model key. Execution: specialized Google Interactions adapter.
 * Primary turns stay on the current conversation; subagent lifecycle only when role=subagent.
 */
import { resolveModelApiKey } from '../integrations/tokens.js';
import { fetchWorkspaceGithubRepo } from './github-repo-scope.js';
import { ANTIGRAVITY_MODEL_KEY } from './antigravity-policy.js';
import {
  loadAntigravitySessionState,
  saveAntigravitySessionState,
} from './antigravity-session-state.js';
import { ensureChatSessionRow } from '../../backend/agentsam/sessions/index.js';
import {
  emptyUsageTokens,
  extractStreamChunkUsage,
  fillMissingUsageFromText,
  usageHasTokens,
} from './openai-usage-tokens.js';

export const ANTIGRAVITY_INTERACTIONS_PLATFORM = 'google_interactions';
export const ANTIGRAVITY_INTERACTIONS_API_REVISION = '2026-05-20';
const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

/** API agent id (no models/ prefix). */
export const ANTIGRAVITY_API_AGENT = 'antigravity-preview-05-2026';

/**
 * @param {string|null|undefined} modelKey
 */
export function normalizeAntigravityAgentId(modelKey) {
  const mk = String(modelKey || ANTIGRAVITY_MODEL_KEY).trim();
  if (!mk) return ANTIGRAVITY_API_AGENT;
  return mk.replace(/^models\//, '');
}

/**
 * Map Interactions API step to a lightweight card for SSE / transcript.
 * @param {Record<string, unknown>} step
 */
export function mapAntigravityStepToCard(step) {
  const type = String(step?.type || step?.step_type || 'output').slice(0, 64);
  const detail =
    typeof step?.text === 'string'
      ? step.text
      : typeof step?.content === 'string'
        ? step.content
        : typeof step?.output === 'string'
          ? step.output
          : '';
  return {
    type,
    title: String(step?.title || step?.name || type).slice(0, 200),
    detail: detail.slice(0, 4000),
    status: String(step?.status || 'working').slice(0, 32),
  };
}

/**
 * @param {unknown} env
 * @param {string} modelKey
 * @param {string|null|undefined} userId
 */
async function resolveGoogleInteractionsApiKey(env, modelKey, userId) {
  const fromModel = await resolveModelApiKey(env, 'google', modelKey, userId);
  if (fromModel) return fromModel;
  for (const k of ['GOOGLE_AI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']) {
    const v = env?.[k] != null ? String(env[k]).trim() : '';
    if (v) return v;
  }
  return '';
}

/**
 * @param {Record<string, unknown>} obj
 */
function extractInteractionSnapshot(obj) {
  const root = obj && typeof obj === 'object' ? obj : {};
  const interaction =
    root.interaction && typeof root.interaction === 'object' ? root.interaction : root;
  return {
    id: interaction.id != null ? String(interaction.id) : null,
    environmentId:
      interaction.environment_id != null ? String(interaction.environment_id) : null,
    outputText:
      typeof interaction.output_text === 'string'
        ? interaction.output_text
        : typeof root.output_text === 'string'
          ? root.output_text
          : '',
    steps: Array.isArray(interaction.steps)
      ? interaction.steps
      : Array.isArray(root.steps)
        ? root.steps
        : [],
  };
}

/**
 * @param {Record<string, unknown>} obj
 */
function extractStreamPiece(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.step && typeof obj.step === 'object') return { kind: 'step', step: obj.step };
  if (obj.type === 'step' || obj.step_type) return { kind: 'step', step: obj };
  const delta = obj.delta && typeof obj.delta === 'object' ? obj.delta : null;
  if (delta && typeof delta.text === 'string' && delta.text) return { kind: 'text', text: delta.text };
  if (typeof obj.text === 'string' && obj.text) return { kind: 'text', text: obj.text };
  if (typeof obj.output_text_delta === 'string' && obj.output_text_delta) {
    return { kind: 'text', text: obj.output_text_delta };
  }
  if (obj.interaction || obj.id || obj.output_text) {
    return { kind: 'interaction', snapshot: extractInteractionSnapshot(obj) };
  }
  return null;
}

/**
 * @param {ReadableStream<Uint8Array>} body
 * @param {(obj: Record<string, unknown>) => void} onJson
 */
async function consumeGoogleInteractionsStream(body, onJson) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let carry = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const lines = carry.split('\n');
    carry = lines.pop() || '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line === '[DONE]') continue;
      let jsonStr = line;
      if (line.startsWith('data:')) jsonStr = line.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      try {
        onJson(JSON.parse(jsonStr));
      } catch {
        /* partial line — ignore */
      }
    }
  }
  const tail = carry.trim();
  if (tail && tail !== '[DONE]') {
    let jsonStr = tail.startsWith('data:') ? tail.slice(5).trim() : tail;
    try {
      onJson(JSON.parse(jsonStr));
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {unknown} env
 * @param {object} opts
 */
async function buildAntigravityInput(env, opts) {
  const message = String(opts?.message || '').trim();
  const lines = [
    '[Remote sandbox task — Google Antigravity managed agent. Work in the isolated Linux environment; produce files, test output, or reports. Agent Sam validates before applying locally.]',
    message,
  ];

  const ws = String(opts?.workspaceId || '').trim();
  const tenantId = opts?.tenantId != null ? String(opts.tenantId).trim() : '';
  if (ws && env?.DB) {
    const repo = await fetchWorkspaceGithubRepo(env, tenantId, ws).catch(() => null);
    if (repo) {
      lines.push(`\nPrimary repository (mount/clone if needed): https://github.com/${repo}`);
    }
  }

  if (opts?.githubScopeLine) {
    lines.push(`\n${String(opts.githubScopeLine).trim()}`);
  }

  if (Array.isArray(opts?.openFiles) && opts.openFiles.length) {
    lines.push(`\nOpen files in IDE: ${opts.openFiles.slice(0, 12).join(', ')}`);
  }

  lines.push(
    '\nDo not request secrets. Return concrete artifacts (paths, diffs, summaries) the orchestrator can review.',
  );
  return lines.join('\n');
}

/**
 * @param {unknown} env
 * @param {string} modelKey
 * @param {string|null|undefined} userId
 * @param {Record<string, unknown>} body
 * @param {boolean} stream
 */
async function postInteractions(env, modelKey, userId, body, stream) {
  const apiKey = await resolveGoogleInteractionsApiKey(env, modelKey, userId);
  if (!apiKey) {
    throw new Error('Google API key required for Antigravity Interactions API');
  }

  const url = stream ? `${INTERACTIONS_URL}?alt=sse` : INTERACTIONS_URL;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
      'Api-Revision': ANTIGRAVITY_INTERACTIONS_API_REVISION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Antigravity Interactions API ${res.status}: ${errText.slice(0, 500) || res.statusText}`,
    );
  }
  return res;
}

/**
 * Stream Antigravity Interactions API turn; emit IAM SSE-shaped events.
 *
 * Default role=primary: same conversation / agent run as any other model.
 * role=subagent: only when real spawn machinery requests it (slug + optional child ids).
 *
 * @param {unknown} env
 * @param {{
 *   message: string,
 *   workspaceId: string,
 *   tenantId?: string|null,
 *   userId?: string|null,
 *   modelKey?: string|null,
 *   githubScopeLine?: string|null,
 *   openFiles?: string[],
 *   freshEnvironment?: boolean,
 *   emit?: (type: string, payload: Record<string, unknown>) => void,
 *   timeoutMs?: number,
 *   conversationId?: string|null,
 *   sessionId?: string|null,
 *   parentRunId?: string|null,
 *   role?: 'primary'|'subagent'|string|null,
 *   subagentSlug?: string|null,
 *   subagent_slug?: string|null,
 *   subagentRunId?: string|null,
 *   childConversationId?: string|null,
 * }} opts
 */
export async function streamAntigravitySandboxInteraction(env, opts) {
  const message = String(opts?.message || '').trim();
  const workspaceId = String(opts?.workspaceId || '').trim();
  const modelKey = opts?.modelKey || ANTIGRAVITY_MODEL_KEY;
  const agentId = normalizeAntigravityAgentId(modelKey);
  const emit = typeof opts?.emit === 'function' ? opts.emit : () => {};
  const tenantId = opts?.tenantId != null ? String(opts.tenantId).trim() : '';
  const userId = opts?.userId != null ? String(opts.userId).trim() : '';
  const conversationId =
    (opts?.conversationId != null && String(opts.conversationId).trim()) ||
    (opts?.sessionId != null && String(opts.sessionId).trim()) ||
    null;
  const parentRunId =
    opts?.parentRunId != null && String(opts.parentRunId).trim()
      ? String(opts.parentRunId).trim()
      : null;
  const role =
    String(opts?.role || 'primary').trim().toLowerCase() === 'subagent' ? 'subagent' : 'primary';
  const subagentSlug =
    role === 'subagent'
      ? String(opts?.subagentSlug ?? opts?.subagent_slug ?? '').trim() || null
      : null;
  let childRunId =
    role === 'subagent' && opts?.subagentRunId != null && String(opts.subagentRunId).trim()
      ? String(opts.subagentRunId).trim()
      : null;
  let childConversationId =
    role === 'subagent' &&
    opts?.childConversationId != null &&
    String(opts.childConversationId).trim()
      ? String(opts.childConversationId).trim()
      : null;

  if (!message || !workspaceId) {
    return {
      ok: false,
      status: 'invalid_input',
      model_key: modelKey,
      message: 'message and workspaceId required',
    };
  }

  // Child chat only when real subagent orchestration asks for it — never invent for primary.
  if (role === 'subagent' && !childConversationId && env?.DB && tenantId && userId) {
    childConversationId = crypto.randomUUID();
    try {
      await ensureChatSessionRow(env, {
        conversationId: childConversationId,
        tenantId,
        userId,
        workspaceId,
        title: subagentSlug ? `Child: ${subagentSlug}` : 'Child: antigravity',
        parentConversationId: conversationId,
        modelKey,
      });
    } catch (e) {
      console.warn('[antigravity-interactions] child session', e?.message ?? e);
      childConversationId = null;
    }
  }

  const session = opts?.freshEnvironment
    ? { interactionId: null, environmentId: null }
    : await loadAntigravitySessionState(env, workspaceId);

  const inputText = await buildAntigravityInput(env, opts);
  /** @type {Record<string, unknown>} */
  const reqBody = {
    agent: agentId,
    input: [{ type: 'text', text: inputText }],
    stream: true,
  };

  if (session.interactionId) {
    reqBody.previous_interaction_id = session.interactionId;
  }
  if (session.environmentId && !opts?.freshEnvironment) {
    reqBody.environment = session.environmentId;
  } else {
    reqBody.environment = { type: 'remote' };
  }

  const t0 = Date.now();
  const sseConversationId =
    role === 'subagent' ? childConversationId || conversationId : conversationId;

  emit('antigravity_interaction_started', {
    type: 'antigravity_interaction_started',
    model_key: modelKey,
    agent: agentId,
    workspace_id: workspaceId,
    conversation_id: sseConversationId,
    role,
    resumed: !!(session.interactionId || session.environmentId),
  });
  if (role === 'subagent' && subagentSlug) {
    emit('agentsam_subagent_run_started', {
      type: 'agentsam_subagent_run_started',
      subagent_slug: subagentSlug,
      subagent_run_id: childRunId,
      parent_run_id: parentRunId,
      model_key: modelKey,
      conversation_id: childConversationId,
      child: {
        agent_run_id: childRunId,
        conversation_id: childConversationId,
      },
    });
  }

  let outputText = '';
  let interactionId = session.interactionId;
  let environmentId = session.environmentId;
  /** @type {Record<string, unknown>[]} */
  const steps = [];
  let usageAcc = emptyUsageTokens();

  try {
    const res = await postInteractions(env, modelKey, opts?.userId, reqBody, true);
    if (!res.body) throw new Error('Antigravity stream missing body');

    await consumeGoogleInteractionsStream(res.body, (obj) => {
      const u = extractStreamChunkUsage(obj);
      if (usageHasTokens(u)) usageAcc = u;
      const piece = extractStreamPiece(obj);
      if (!piece) return;

      if (piece.kind === 'text') {
        outputText += piece.text;
        emit('antigravity_step', {
          type: 'antigravity_step',
          step: mapAntigravityStepToCard({ type: 'model_output', text: piece.text, status: 'working' }),
        });
        return;
      }

      if (piece.kind === 'step') {
        const card = mapAntigravityStepToCard(piece.step);
        steps.push(piece.step);
        emit('antigravity_step', { type: 'antigravity_step', step: card });
        if (role === 'subagent' && subagentSlug) {
          emit('agentsam_subagent_run_progress', {
            type: 'agentsam_subagent_run_progress',
            subagent_slug: subagentSlug,
            subagent_run_id: childRunId,
            conversation_id: childConversationId,
            child: {
              agent_run_id: childRunId,
              conversation_id: childConversationId,
            },
            message: card.title,
          });
        }
        return;
      }

      if (piece.kind === 'interaction' && piece.snapshot) {
        if (piece.snapshot.id) interactionId = piece.snapshot.id;
        if (piece.snapshot.environmentId) environmentId = piece.snapshot.environmentId;
        if (piece.snapshot.outputText) outputText = piece.snapshot.outputText;
        for (const st of piece.snapshot.steps) {
          steps.push(st);
          emit('antigravity_step', { type: 'antigravity_step', step: mapAntigravityStepToCard(st) });
        }
      }
    });

    if (!outputText && steps.length) {
      const last = steps[steps.length - 1];
      outputText =
        typeof last?.text === 'string'
          ? last.text
          : typeof last?.content === 'string'
            ? last.content
            : '';
    }

    if (interactionId || environmentId) {
      await saveAntigravitySessionState(env, workspaceId, { interactionId, environmentId });
    }

    const latencyMs = Date.now() - t0;
    emit('antigravity_interaction_complete', {
      type: 'antigravity_interaction_complete',
      model_key: modelKey,
      interaction_id: interactionId,
      environment_id: environmentId,
      output_text: outputText.slice(0, 120000),
      step_count: steps.length,
      latency_ms: latencyMs,
      role,
    });
    if (role === 'subagent' && subagentSlug) {
      emit('agentsam_subagent_run_result', {
        type: 'agentsam_subagent_run_result',
        subagent_slug: subagentSlug,
        subagent_run_id: childRunId,
        conversation_id: childConversationId,
        child: {
          agent_run_id: childRunId,
          conversation_id: childConversationId,
        },
        status: 'ok',
        latency_ms: latencyMs,
      });
    }

    await recordAntigravityOutcome(env, modelKey, workspaceId, true, latencyMs);

    const usage = fillMissingUsageFromText(usageAcc, {
      inputText,
      outputText,
    });

    return {
      ok: true,
      status: 'completed',
      model_key: modelKey,
      interaction_id: interactionId,
      environment_id: environmentId,
      conversation_id: sseConversationId,
      role,
      output_text: outputText,
      steps,
      latency_ms: latencyMs,
      usage,
      message: outputText.slice(0, 8000) || 'Antigravity completed.',
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const errMsg = err?.message != null ? String(err.message) : String(err);
    emit('antigravity_interaction_error', {
      type: 'antigravity_interaction_error',
      model_key: modelKey,
      error: errMsg.slice(0, 2000),
      role,
    });
    if (role === 'subagent' && subagentSlug) {
      emit('agentsam_subagent_run_result', {
        type: 'agentsam_subagent_run_result',
        subagent_slug: subagentSlug,
        subagent_run_id: childRunId,
        conversation_id: childConversationId,
        child: {
          agent_run_id: childRunId,
          conversation_id: childConversationId,
        },
        status: 'failed',
        error: errMsg.slice(0, 500),
      });
    }
    await recordAntigravityOutcome(env, modelKey, workspaceId, false, latencyMs);
    return {
      ok: false,
      status: 'error',
      model_key: modelKey,
      conversation_id: sseConversationId,
      role,
      message: errMsg,
      latency_ms: latencyMs,
    };
  }
}

/**
 * @param {unknown} env
 * @param {string} modelKey
 * @param {string} workspaceId
 * @param {boolean} success
 * @param {number} latencyMs
 */
export async function recordAntigravityOutcome(env, modelKey, workspaceId, success, latencyMs) {
  const ws = String(workspaceId || '').trim();
  const mk = String(modelKey || ANTIGRAVITY_MODEL_KEY).trim();
  if (!env?.DB || !ws || !mk) return;
  try {
    const { applyRewardEvent, resolveTenantIdForReward } = await import('./reward-events.js');
    const tenantId = await resolveTenantIdForReward(env, { workspaceId: ws });
    if (!tenantId) {
      console.warn('[antigravity-interactions] recordOutcome skipped — no tenant_id');
      return;
    }
    await applyRewardEvent(env, {
      tenant_id: tenantId,
      workspace_id: ws,
      task_type: 'antigravity',
      signal_type: success ? 'auto_success' : 'auto_error',
      signal_value: 1,
      model_key: mk,
      latency_ms: latencyMs,
      apply_cost: false,
      apply_latency: Number.isFinite(Number(latencyMs)) && Number(latencyMs) >= 0,
      apply_execution: true,
      dedup_key: `antigravity:${ws}:${mk}:${Math.floor(Date.now() / 1000)}:${success ? 'ok' : 'err'}`,
      reason: 'recordAntigravityOutcome',
    });
  } catch (e) {
    console.warn('[antigravity-interactions] recordOutcome', e?.message ?? e);
  }
}

/**
 * @param {any} env
 * @param {{ message: string, workspaceId: string, tenantId?: string|null, userId?: string|null, emit?: Function, freshEnvironment?: boolean, githubScopeLine?: string|null, openFiles?: string[] }} opts
 */
export async function dispatchAntigravitySandboxInteraction(env, opts) {
  return streamAntigravitySandboxInteraction(env, opts);
}

/**
 * Build system-prompt appendix from Antigravity output for local orchestrator validation.
 * @param {{ output_text?: string, interaction_id?: string|null, environment_id?: string|null }} result
 */
export function formatAntigravityOrchestratorBlock(result) {
  const text = String(result?.output_text || '').trim();
  if (!text) return '';
  const meta = [
    result?.interaction_id ? `interaction_id=${result.interaction_id}` : '',
    result?.environment_id ? `environment_id=${result.environment_id}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return [
    '## Antigravity remote sandbox result',
    meta ? `(${meta})` : '',
    text.slice(0, 12000),
  ]
    .filter(Boolean)
    .join('\n');
}
