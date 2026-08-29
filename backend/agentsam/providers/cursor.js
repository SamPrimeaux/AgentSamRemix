/** Cursor Cloud Agent provider adapter. */
import { jsonResponse } from '../../http/agentsam/shared.js';
import { openAiSseResponse } from '../runtime/provider-stream.js';

export function resolveCursorProviderApiKey(env) {
  const key = env?.CURSOR_API_KEY || env?.CURSOR_API_TOKEN;
  return key != null && String(key).trim() ? String(key).trim() : null;
}

export function buildCursorProviderPrompt(systemPrompt, messages = []) {
  const parts = [];
  if (systemPrompt) parts.push(`System:\n${String(systemPrompt).trim()}`);
  for (const message of messages) {
    const content = Array.isArray(message?.content)
      ? message.content.map((block) => typeof block === 'string' ? block : block?.text || block?.content || '').filter(Boolean).join('\n')
      : message?.content;
    if (String(content || '').trim()) parts.push(`${message.role || 'user'}:\n${String(content).trim()}`);
  }
  return parts.join('\n\n');
}

export async function dispatchCursorStream(env, request, params) {
  void request;
  const apiKey = resolveCursorProviderApiKey(env);
  if (!apiKey) return jsonResponse({ error: 'CURSOR_API_KEY not configured' }, 503);
  const model = String(params.providerModelId || params.modelKey || 'composer-2.5').replace(/^cursor\//, '');
  const create = await fetch('https://api.cursor.com/v1/agents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: { text: buildCursorProviderPrompt(params.systemPrompt, params.messages) },
      model: { id: model },
      mode: 'agent',
      mcpServers: [{
        name: 'inneranimalmedia',
        type: 'http',
        url: 'https://mcp.inneranimalmedia.com/mcp',
        headers: { Authorization: `Bearer ${env.MCP_INTERNAL_TOKEN || apiKey}` },
      }],
    }),
    ...(params.signal ? { signal: params.signal } : {}),
  });
  const data = await create.json().catch(() => ({}));
  if (!create.ok) return jsonResponse({ error: `Cursor API error: ${create.status}`, detail: JSON.stringify(data).slice(0, 400) }, create.status);
  const agentId = data?.agent?.id || data?.id || data?.agent_id;
  const runId = data?.run?.id || data?.runId || data?.agent?.latestRunId;
  if (!agentId || !runId) return jsonResponse({ error: 'Cursor API missing agent or run id' }, 502);
  const stream = await fetch(`https://api.cursor.com/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/stream`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'text/event-stream' },
    ...(params.signal ? { signal: params.signal } : {}),
  });
  if (!stream.ok || !stream.body) return jsonResponse({ error: `Cursor stream unavailable: ${stream.status}` }, 502);
  return openAiSseResponse(stream.body, {
    'X-Provider': 'cursor_sdk',
    'X-Cursor-Agent-Id': String(agentId),
    'X-Cursor-Run-Id': String(runId),
  });
}

export function dispatchCursorComplete() {
  throw new Error('Unsupported completion: Cursor Composer exposes a stream-only contract');
}

export { dispatchCursorStream as dispatchCursorComposerStream };
