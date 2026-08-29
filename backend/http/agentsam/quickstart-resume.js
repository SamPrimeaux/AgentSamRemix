import { agentChatSseHandler } from './chat-turn.js';

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return fallback;
  }
}

/**
 * Keep quickstart continuation deterministic even when an older batch row does
 * not contain the optional exploration fields.
 *
 * @param {Record<string, unknown>} batch
 */
function defaultEnrichedGoal(batch) {
  const goal = String(batch?.goal_text || '').trim();
  const questions = parseJson(batch?.questions_json, []);
  const answers = parseJson(batch?.answers_json, {});
  const lines = [goal];

  if (Array.isArray(questions) && answers && typeof answers === 'object') {
    const clarifications = questions
      .map((question) => {
        const id = String(question?.id || '').trim();
        const answer = id ? answers[id] : '';
        return id && answer ? `- ${String(question?.question || id)} → ${String(answer)}` : null;
      })
      .filter(Boolean);
    if (clarifications.length) lines.push('', 'User clarifications:', ...clarifications);
  }

  const optional = String(batch?.optional_details || '').trim();
  if (optional) lines.push('', `Additional details: ${optional}`);

  const explore = parseJson(batch?.explore_summary_json, null);
  if (explore?.synthesis) lines.push('', `Explore notes: ${String(explore.synthesis)}`);
  return lines.join('\n').trim();
}

function requestHeaders(request) {
  const headers = new Headers();
  for (const name of ['accept', 'authorization', 'cookie', 'origin', 'user-agent']) {
    const value = request?.headers?.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('content-type', 'application/json');
  return headers;
}

/**
 * Resume the original Agent turn after Quickstart answers are submitted.
 *
 * The submit endpoint is itself an SSE endpoint, so continuation re-enters the
 * canonical chat handler with the same authenticated request headers and an
 * enriched, non-quickstart body. This preserves the normal turn/session/SSE
 * lifecycle rather than synthesizing a second response format here.
 *
 * @param {{
 *   services: Record<string, any>,
 *   planServices?: Record<string, any>,
 *   buildEnrichedGoalFromIntakeBatch?: Function
 * }} options
 */
export function createQuickstartIntakeResume({
  services,
  planServices = null,
  buildEnrichedGoalFromIntakeBatch,
} = {}) {
  if (!services || typeof services.executeAgentChatSpine !== 'function') {
    return null;
  }

  return async function resumeQuickstartIntakeTurn(env, ctx, { batch, input } = {}) {
    const request = input?.request;
    if (!(request instanceof Request)) {
      throw new TypeError('quickstart_intake_resume_request_required');
    }
    const goal =
      typeof buildEnrichedGoalFromIntakeBatch === 'function'
        ? String(buildEnrichedGoalFromIntakeBatch(batch) || '').trim()
        : defaultEnrichedGoal(batch);
    if (!goal) throw new Error('quickstart_intake_resume_goal_required');

    const roadblock = parseJson(batch?.roadblock_context_json, {});
    const body = {
      message: goal,
      user_message: goal,
      mode: String(roadblock?.requested_mode || 'agent'),
      route_key: roadblock?.route_key || undefined,
      task_type: roadblock?.task_type || undefined,
      model: roadblock?.model_key || undefined,
      model_key: roadblock?.model_key || undefined,
      subagent_slug: roadblock?.subagent_slug || undefined,
      session_id: batch?.session_id || input?.sessionId || undefined,
      conversation_id: batch?.session_id || input?.sessionId || undefined,
      quickstart_batch: null,
      quickstart_card: null,
    };

    const continuationRequest = new Request(request.url, {
      method: 'POST',
      headers: requestHeaders(request),
      body: JSON.stringify(
        Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)),
      ),
    });

    return agentChatSseHandler(env, continuationRequest, ctx, {
      services,
      planServices,
    });
  };
}
