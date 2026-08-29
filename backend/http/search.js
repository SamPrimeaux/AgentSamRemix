/**
 * API Service: Cloudflare AI Search (AutoRAG)
 * Handles semantic search and RAG chat completions.
 */

export async function handleSearchHttp(request, url, env, _ctx) {
  const method = request.method.toUpperCase();
  const path = url.pathname.toLowerCase();

  // Auth guard — require valid session
  const { getAuthUser, jsonResponse } = await import('../../src/core/auth.js');
  const authUser = await getAuthUser(request, env);
  if (!authUser) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const token = env.AI_SEARCH_TOKEN;
  const base = env.AI_SEARCH_ENDPOINT;

  // POST /api/search — semantic search or catalog-backed chat (no AI Search chat proxy)
  if (method === 'POST' && path === '/api/search') {
    let body;
    try {
      body = await request.json();
    } catch (_) {
      return jsonResponse({ error: 'Invalid JSON' }, 400);
    }

    const { query, mode = 'search' } = body;
    if (!query) {
      return jsonResponse({ error: 'query required' }, 400);
    }

    if (mode === 'chat') {
      if (!env.DB) {
        return jsonResponse({ error: 'Database required for chat mode' }, 503);
      }
      try {
        const { dispatchComplete } = await import('../agentsam/runtime/provider-dispatch.js');
        const modelKey =
          body.model != null && String(body.model).trim()
            ? String(body.model).trim()
            : body.model_key != null && String(body.model_key).trim()
              ? String(body.model_key).trim()
              : 'auto';
        const ws =
          authUser.active_workspace_id != null && String(authUser.active_workspace_id).trim() !== ''
            ? String(authUser.active_workspace_id).trim()
            : '';
        const data = await dispatchComplete(env, {
          modelKey,
          taskType: 'chat',
          mode: 'auto',
          workspaceId: ws,
          tenantId: authUser.tenant_id ?? null,
          userId: authUser.user_id ?? authUser.id ?? null,
          systemPrompt: typeof body.system === 'string' ? body.system : undefined,
          messages:
            Array.isArray(body.messages) && body.messages.length
              ? body.messages
              : [{ role: 'user', content: query }],
          tools: [],
          options: { reasoningEffort: 'low', verbosity: 'low' },
        });
        const text =
          (typeof data?.text === 'string' && data.text) ||
          data?.choices?.[0]?.message?.content ||
          data?.output_text ||
          '';
        return jsonResponse({
          id: data?.id != null ? String(data.id) : `chat_${Date.now()}`,
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: String(text) },
              finish_reason: 'stop',
            },
          ],
          model: data?.model ?? modelKey,
          usage: data?.usage ?? null,
        });
      } catch (e) {
        return jsonResponse({ error: 'chat failed', detail: e.message }, 502);
      }
    }

    if (!token || !base) {
      return jsonResponse({ error: 'AI Search not configured' }, 503);
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const endpoint = `${base}/search`;
    const requestBody = { query };

    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      const raw = await upstream.text();
      let data;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        return jsonResponse(
          {
            error: 'AI Search returned non-JSON response',
            status: upstream.status,
          },
          upstream.ok ? 502 : upstream.status,
        );
      }
      return jsonResponse(data, upstream.status);
    } catch (e) {
      return jsonResponse({ error: 'AI Search request failed', detail: e.message }, 502);
    }
  }

  return jsonResponse({ error: 'Not found' }, 404);
}
