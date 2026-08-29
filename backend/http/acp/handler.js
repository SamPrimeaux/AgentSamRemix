/**
 * Standards-compliant ACP agent HTTP surface for Agent Sam.
 *
 * Logical route: /api/acp (Streamable HTTP / NDJSON for prompt turns).
 * Domain: sessionId = conversation_id; each prompt → agentsam_agent_run.
 * cursor-acp.js is migration facade only — not this module.
 */

import { agentChatSseHandler } from '../agentsam/chat-turn.js';
import { buildInitializeResult, summarizeClientCapabilities } from './capabilities.js';
import { chatEventToAcpSessionUpdate } from './event-adapter.js';
import {
  ACP_PROTOCOL_VERSION,
  jsonRpcNotification,
  jsonRpcResult,
  parseJsonRpcRequest,
} from './jsonrpc.js';
import {
  assertNotAgentRunIdAsSession,
  createAcpChatSession,
  extractAcpPromptText,
  loadAcpChatSession,
} from './session.js';

/** @type {Map<string, Record<string, unknown>>} */
const sessionClientCaps = new Map();

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function handleAcpRequest(request, env, ctx, { identity: suppliedIdentity, chatServices } = {}) {
  const methodUpper = request.method.toUpperCase();
  if (methodUpper === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  if (methodUpper === 'GET') {
    // Health / transport spike advertisement (unary).
    return jsonResponse(
      {
        ok: true,
        protocol: 'acp',
        protocolVersion: ACP_PROTOCOL_VERSION,
        transport: 'streamable_http_ndjson',
        surface: '/api/acp',
      },
      200,
    );
  }

  if (methodUpper !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const identity = suppliedIdentity;
  if (!identity?.userId || !identity?.tenantId || !identity?.workspaceId) {
    return rpcHttp(jsonRpcResult(null, null, { code: -32001, message: 'Unauthorized' }), 401);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return rpcHttp(jsonRpcResult(null, null, { code: -32700, message: 'Parse error' }), 400);
  }

  const parsed = parseJsonRpcRequest(body);
  if (!parsed.ok) {
    return rpcHttp(parsed.response, 400);
  }

  const { id, method, params } = parsed;

  try {
    switch (method) {
      case 'initialize': {
        const clientCaps = summarizeClientCapabilities(
          /** @type {any} */ (params).clientCapabilities || {},
        );
        return rpcHttp(jsonRpcResult(id, buildInitializeResult()), 200, {
          'X-ACP-Client-Fs': clientCaps.fs ? '1' : '0',
          'X-ACP-Client-Terminal': clientCaps.terminal ? '1' : '0',
        });
      }

      case 'authenticate':
        return rpcHttp(jsonRpcResult(id, {}), 200);

      case 'session/new': {
        const created = await createAcpChatSession(env, {
          userId: identity.userId,
          tenantId: identity.tenantId,
          workspaceId: identity.workspaceId,
          title: params?.cwd != null ? `ACP ${String(params.cwd).slice(0, 80)}` : 'ACP session',
        });
        const caps = summarizeClientCapabilities(
          /** @type {any} */ (params).mcpCapabilities ||
            /** @type {any} */ (params).clientCapabilities ||
            {},
        );
        sessionClientCaps.set(created.sessionId, caps);
        return rpcHttp(
          jsonRpcResult(id, {
            sessionId: created.sessionId,
            _meta: {
              iam: {
                conversation_id: created.conversationId,
                mapping: 'sessionId_is_conversation_id',
              },
            },
          }),
          200,
        );
      }

      case 'session/load': {
        const sessionId = String(params?.sessionId || '').trim();
        assertNotAgentRunIdAsSession(sessionId);
        const loaded = await loadAcpChatSession(env, {
          sessionId,
          userId: identity.userId,
        });
        return rpcHttp(
          jsonRpcResult(id, {
            sessionId: loaded.sessionId,
            _meta: { iam: { conversation_id: loaded.conversationId } },
          }),
          200,
        );
      }

      case 'session/prompt': {
        const sessionId = String(params?.sessionId || '').trim();
        if (!sessionId) {
          return rpcHttp(
            jsonRpcResult(id, null, { code: -32602, message: 'sessionId required' }),
            400,
          );
        }
        assertNotAgentRunIdAsSession(sessionId);
        await loadAcpChatSession(env, { sessionId, userId: identity.userId });
        const message = extractAcpPromptText(params?.prompt);
        if (!message) {
          return rpcHttp(
            jsonRpcResult(id, null, { code: -32602, message: 'prompt text required' }),
            400,
          );
        }
        return streamAcpPromptTurn({
          request,
          env,
          ctx,
          identity,
          rpcId: id,
          sessionId,
          message,
          mode: params?.mode != null ? String(params.mode) : 'agent',
        });
      }

      case 'session/cancel': {
        const sessionId = String(params?.sessionId || '').trim();
        assertNotAgentRunIdAsSession(sessionId);
        // Best-effort: mark latest running run for conversation cancelled.
        if (env?.DB && sessionId) {
          await env.DB.prepare(
            `UPDATE agentsam_agent_run
             SET status = 'cancelled', updated_at_unix = unixepoch()
             WHERE conversation_id = ? AND user_id = ? AND status IN ('running','queued')`,
          )
            .bind(sessionId, identity.userId)
            .run()
            .catch(() => {});
        }
        return rpcHttp(jsonRpcResult(id, {}), 200);
      }

      default:
        return rpcHttp(
          jsonRpcResult(id, null, { code: -32601, message: `Method not found: ${method}` }),
          404,
        );
    }
  } catch (e) {
    const code = /** @type {any} */ (e)?.code;
    const message = e instanceof Error ? e.message : String(e);
    return rpcHttp(
      jsonRpcResult(id, null, {
        code: typeof code === 'number' ? code : -32000,
        message,
      }),
      500,
    );
  }
}

/**
 * Run a chat turn via agentChatSseHandler; stream ACP session/update notifications as NDJSON,
 * then a final JSON-RPC result. Each turn creates its own agentsam_agent_run inside the chat spine.
 *
 * @param {{
 *   request: Request,
 *   env: any,
 *   ctx: ExecutionContext,
 *   identity: Record<string, unknown>,
 *   rpcId: unknown,
 *   sessionId: string,
 *   message: string,
 *   mode: string,
 * }} p
 */
async function streamAcpPromptTurn(p) {
  const { env, ctx, identity, rpcId, sessionId, message, mode } = p;

  const chatBody = {
    message,
    sessionId,
    conversation_id: sessionId,
    session_id: sessionId,
    mode: mode === 'ask' || mode === 'plan' ? mode : 'agent',
    trigger: 'acp',
    acp_session: true,
    source: 'acp',
  };

  const chatReq = new Request(new URL('/api/agent/chat', p.request.url).toString(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: p.request.headers.get('cookie') || '',
      authorization: p.request.headers.get('authorization') || '',
    },
    body: JSON.stringify(chatBody),
  });

  const sseRes = await agentChatSseHandler(env, chatReq, ctx, {
    identity,
    chatServices,
    planServices: null,
  });
  if (!sseRes.ok || !sseRes.body) {
    const errText = await sseRes.text().catch(() => '');
    return rpcHttp(
      jsonRpcResult(rpcId, null, {
        code: -32000,
        message: `chat_turn_failed:${sseRes.status}:${errText.slice(0, 400)}`,
      }),
      502,
    );
  }

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const writeLine = async (obj) => {
    await writer.write(encoder.encode(`${JSON.stringify(obj)}\n`));
  };

  (async () => {
    try {
      const reader = sseRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let stopReason = 'end_turn';
      let sawDone = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';
        for (const chunk of chunks) {
          const line = chunk
            .split('\n')
            .map((l) => l.trim())
            .find((l) => l.startsWith('data:'));
          if (!line) continue;
          let evt = null;
          try {
            evt = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (!evt || typeof evt !== 'object') continue;
          const type = String(evt.type || '');
          if (type === 'done') {
            sawDone = true;
            if (evt.stop_reason) stopReason = String(evt.stop_reason);
            else if (evt.cancelled) stopReason = 'cancelled';
            continue;
          }
          if (type === 'error') {
            stopReason = 'refusal';
          }
          const update = chatEventToAcpSessionUpdate(type, evt, sessionId);
          if (update) {
            await writeLine(jsonRpcNotification('session/update', update));
          }
        }
      }

      if (!sawDone && stopReason === 'end_turn') {
        /* normal */
      }

      await writeLine(
        jsonRpcResult(rpcId, {
          stopReason,
          _meta: {
            iam: {
              conversation_id: sessionId,
              transport: 'streamable_http_ndjson',
            },
          },
        }),
      );
    } catch (e) {
      await writeLine(
        jsonRpcResult(rpcId, null, {
          code: -32000,
          message: e instanceof Error ? e.message : String(e),
        }),
      ).catch(() => {});
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-ACP-Transport': 'streamable_http_ndjson',
      'X-ACP-Session-Id': sessionId,
    },
  });
}

/**
 * @param {object} body
 * @param {number} status
 * @param {Record<string, string>} [extraHeaders]
 */
function rpcHttp(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

/** @param {unknown} data @param {number} status */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie',
  };
}
