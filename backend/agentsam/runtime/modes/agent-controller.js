/**
 * Agent controller facade — SSE stream orchestration.
 * When early SSE already owns the writer (`input.emit`), reuse it (no nested stream).
 */

import { jsonResponse } from '../../../http/agentsam/shared.js';
import { isAgentRunAbortError } from '../spawn/abort.js';
import { reportAgentControllerWarning } from './agent-controller-report.js';
import { resolveAgentControllerBindings } from './agent-controller-bind.js';
import { prepareAgentControllerTurn } from './agent-controller-prepare.js';
import { executeAgentControllerTurn } from './agent-controller-execute-turn.js';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'Access-Control-Allow-Origin': '*',
};

/**
 * @param {any} env
 * @param {any} ctx
 * @param {any} input
 * @param {(type: string, payload?: object) => any} emit
 * @param {() => Promise<void>} closeStream
 */
async function runPreparedTurn(env, ctx, input, bound, emit, closeStream) {
  try {
    emit('status', { phase: 'context' });
    const prepared = await prepareAgentControllerTurn(env, ctx, emit, bound, input);
    await executeAgentControllerTurn(env, ctx, emit, closeStream, prepared);
  } catch (setupErr) {
    if (isAgentRunAbortError(setupErr)) {
      emit('done', { cancelled: true });
      await closeStream();
      return;
    }
    reportAgentControllerWarning(env, 'setup_failed', setupErr, {
      workspaceId: bound.workspaceId,
      tenantId: bound.tenantId,
      sessionId: bound.sessionId,
    });
    emit('error', {
      message: String(setupErr?.message || setupErr || 'Agent setup failed'),
      code: 'agent_setup_error',
    });
    emit('done', {});
    await closeStream();
  }
}

/**
 * Shared SSE tool-loop runner for ask / agent / debug profiles.
 * Controllers validate mode before calling.
 *
 * @param {any} env
 * @param {any} ctx
 * @param {any} input
 */
export async function runSharedProfileToolLoop(env, ctx, input) {
  const bound = await resolveAgentControllerBindings(env, input);
  if (!bound.profile.model_key) {
    return jsonResponse(
      { error: 'no_model_resolved', profile_id: bound.profile.profile_id },
      503,
    );
  }

  // Early SSE already opened the client stream — run on that writer (awaited).
  // Nested TransformStream + void IIFE was the double-dispatch hang: prepare could
  // stall for tens of seconds with last_turn_status=in_progress and zero agent_run rows.
  if (typeof input.emit === 'function') {
    const emit = (type, payload = {}) => input.emit(type, payload);
    const closeStream = async () => {};
    emit('thinking_start', {});
    await runPreparedTurn(env, ctx, input, bound, emit, closeStream);
    return null;
  }

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const pendingWrites = new Set();
  const emit = (type, payload = {}) => {
    const write = writer
      .write(encoder.encode(`data: ${JSON.stringify({ type, ...payload })}\n\n`))
      .catch(() => {});
    pendingWrites.add(write);
    write.then(
      () => pendingWrites.delete(write),
      () => pendingWrites.delete(write),
    );
    return write;
  };
  const closeStream = async () => {
    await Promise.allSettled([...pendingWrites]);
    await writer.close().catch(() => {});
  };

  emit('thinking_start', {});
  void runPreparedTurn(env, ctx, input, bound, emit, closeStream);

  return new Response(readable, { headers: SSE_HEADERS });
}
