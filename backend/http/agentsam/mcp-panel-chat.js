/**
 * MCP panel chat HTTP/SSE adapter.
 * Transport only — runtime lives in backend/agentsam/mcp/panel-chat-runtime.js.
 */
import { jsonResponse } from './shared.js';
import { createSseStream } from '../sse.js';
import {
  validateMcpPanelChatInput,
  prepareMcpPanelChatRuntime,
  executeMcpPanelChat,
} from '../../agentsam/mcp/panel-chat-runtime.js';

/**
 * @param {any} env
 * @param {Request} request
 * @param {any} ctx
 * @param {Record<string, unknown>} panel Trusted server-side panel payload
 */
export async function mcpPanelAgentChatSse(env, request, ctx, panel) {
  const input = validateMcpPanelChatInput(panel);
  if (!input.ok) return jsonResponse(input.body, input.httpStatus);

  const prepared = await prepareMcpPanelChatRuntime(env, input);
  if (!prepared.ok) return jsonResponse(prepared.body, prepared.httpStatus);

  const stream = createSseStream();
  const emitTyped = (type, payload = {}) => {
    stream.emit({ type, ...payload });
  };

  ;(async () => {
    try {
      await executeMcpPanelChat(env, request, ctx, input, prepared, emitTyped);
    } finally {
      await stream.close();
    }
  })();

  return stream.response;
}
