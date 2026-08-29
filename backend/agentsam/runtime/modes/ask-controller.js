import { jsonResponse } from '../../../http/agentsam/shared.js';
import { runSharedProfileToolLoop } from './agent-controller.js';
import { runtimeContextPayload, legacyContextPayload } from './runtime-context.js';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'Access-Control-Allow-Origin': '*',
};

/**
 * Ask controller
 * - purpose: explain / inspect / answer
 * - writes: never
 * - tools: only read-only evidence (compiled upstream)
 * - mutation request: stop and tell user to switch to Agent
 *
 * @param {any} env
 * @param {any} ctx
 * @param {any} input
 */
export async function executeAskTurn(env, ctx, input) {
  const profile = input.profile;
  if (profile.mode !== 'ask') {
    return jsonResponse(
      { error: 'ask_controller_mode_mismatch', mode: profile.mode },
      400,
    );
  }

  const message = String(input.message || '');
  const mutationIntent =
    /\b(fix|patch|edit|implement|deploy|run|execute|write|create|add|update|migrate|refactor|change)\b/i.test(
      message,
    );
  const hasCodeContext = /\b(@|`|file|src\/|dashboard\/|stack trace|traceback)\b/i.test(message);

  if (mutationIntent && !hasCodeContext) {
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const emit = (type, payload) => {
      try {
        writer.write(encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`));
      } catch (_) {}
    };

    emit('runtime_context', runtimeContextPayload(profile, { modelOverride: input.modelOverride ?? null }));
    emit('context', legacyContextPayload(profile, { toolsCount: 0, modelOverride: input.modelOverride ?? null }));
    emit('text', {
      text: 'Ask mode is read-only. To implement/fix/run/deploy, switch to **Agent** (or **Debug** for evidence-first fixes).',
    });
    emit('done', {});
    writer.close().catch(() => {});
    return new Response(readable, { headers: SSE_HEADERS });
  }

  // Ask turn uses the shared tool loop; validateToolCall enforces read-only policy.
  return runSharedProfileToolLoop(env, ctx, input);
}

