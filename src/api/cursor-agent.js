/**
 * Cursor Cloud Agents API — spawn, stream, status routes + provider dispatch (cursor_sdk).
 */
import { getAuthUser, jsonResponse, fetchAuthUserTenantId } from '../core/auth.js';
import { getVaultSecrets, secretFromVault } from '../core/vault.js';
import { isVaultConfigured } from '../../backend/credentials/vault-key-material.js';
import { pragmaTableInfo } from '../../backend/services/retention.js';

const CURSOR_API_BASE = 'https://api.cursor.com/v1';

/** @param {any} env */
export function resolveCursorApiKey(env) {
  const key = env?.CURSOR_API_KEY || env?.CURSOR_API_TOKEN;
  return key != null && String(key).trim() !== '' ? String(key).trim() : null;
}

/** @param {any} env */
export async function resolveCursorWebhookSecret(env) {
  let secret = env?.CURSOR_WEBHOOK_SECRET;
  if (secret != null && String(secret).trim() !== '') return String(secret).trim();
  if (env?.DB && isVaultConfigured(env)) {
    try {
      const vault = await getVaultSecrets(env);
      secret = secretFromVault(vault, env, 'CURSOR_WEBHOOK_SECRET');
      if (secret != null && String(secret).trim() !== '') return String(secret).trim();
    } catch {
      /* vault unavailable */
    }
  }
  return null;
}

/**
 * @param {string} systemPrompt
 * @param {Array<{ role?: string, content?: unknown }>} messages
 */
export function buildCursorPromptFromChat(systemPrompt, messages) {
  const parts = [];
  if (systemPrompt && String(systemPrompt).trim()) {
    parts.push(`System:\n${String(systemPrompt).trim()}`);
  }
  for (const m of messages || []) {
    const role = String(m?.role || 'user').toLowerCase();
    let content = m?.content;
    if (Array.isArray(content)) {
      content = content
        .map((c) => (typeof c === 'string' ? c : c?.text || c?.content || ''))
        .filter(Boolean)
        .join('\n');
    }
    content = String(content ?? '').trim();
    if (!content) continue;
    parts.push(`${role}:\n${content}`);
  }
  return parts.join('\n\n');
}

/** owner/name or URL → https://github.com/owner/name for v1 repos[].url */
export function toCursorGithubRepoUrl(repo) {
  const raw = String(repo || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/\.git$/i, '').replace(/\/+$/, '');
  }
  const full = raw
    .replace(/^github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+/, '');
  if (!full.includes('/')) return '';
  return `https://github.com/${full}`;
}

/**
 * @param {any} env
 * @param {{
 *   prompt: string,
 *   model: string,
 *   repo?: string | null,
 *   branch?: string,
 *   agentRunId?: string | null,
 *   tenantId?: string | null,
 *   workspaceId?: string | null,
 * }} opts
 */
export async function spawnCursorCloudAgent(env, opts) {
  const apiKey = resolveCursorApiKey(env);
  if (!apiKey) {
    return { ok: false, status: 503, error: 'CURSOR_API_KEY not configured' };
  }

  const promptText = String(opts.prompt || '').trim();
  if (!promptText) return { ok: false, status: 400, error: 'prompt required' };

  const model = String(opts.model || 'composer-2.5').trim();
  const repoUrl = toCursorGithubRepoUrl(opts.repo);
  const branch = opts.branch != null ? String(opts.branch).trim() : 'main';
  const mcpToken =
    env?.MCP_INTERNAL_TOKEN != null && String(env.MCP_INTERNAL_TOKEN).trim() !== ''
      ? String(env.MCP_INTERNAL_TOKEN).trim()
      : apiKey;

  // Cloud Agents API v1 — prompt/model/repos/mcpServers are objects/arrays (not v0 flat strings).
  // Webhooks: still v0-only per Cursor docs; omit on v1 create.
  const body = {
    prompt: { text: promptText },
    model: { id: model },
    mode: 'agent',
    mcpServers: [
      {
        name: 'inneranimalmedia',
        type: 'http',
        url: 'https://mcp.inneranimalmedia.com/mcp',
        headers: {
          Authorization: `Bearer ${mcpToken}`,
        },
      },
    ],
  };
  if (repoUrl) {
    body.repos = [{ url: repoUrl, ...(branch ? { startingRef: branch } : {}) }];
  }

  const spawnRes = await fetch(`${CURSOR_API_BASE}/agents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!spawnRes.ok) {
    const errText = await spawnRes.text();
    return {
      ok: false,
      status: spawnRes.status,
      error: `Cursor API error: ${spawnRes.status}`,
      detail: errText.slice(0, 400),
    };
  }

  const raw = await spawnRes.text();
  let agentData = {};
  try {
    agentData = raw ? JSON.parse(raw) : {};
  } catch {
    return { ok: false, status: 502, error: 'Cursor API returned non-JSON response', detail: raw.slice(0, 200) };
  }

  const agentId =
    agentData?.agent?.id || agentData?.id || agentData?.agent_id || agentData?.agentId || null;
  const runId =
    agentData?.run?.id ||
    agentData?.runId ||
    agentData?.agent?.latestRunId ||
    agentData?.latestRunId ||
    null;
  if (!agentId) {
    return { ok: false, status: 502, error: 'Cursor API missing agent id', detail: raw.slice(0, 200) };
  }
  if (!runId) {
    return { ok: false, status: 502, error: 'Cursor API missing run id', detail: raw.slice(0, 200) };
  }

  const externalId = String(agentId);
  const externalRunId = String(runId);
  const agentRunId = opts.agentRunId != null ? String(opts.agentRunId).trim() : '';
  const tenantId =
    opts.tenantId != null && String(opts.tenantId).trim() !== ''
      ? String(opts.tenantId).trim()
      : '';
  const workspaceId =
    opts.workspaceId != null && String(opts.workspaceId).trim() !== ''
      ? String(opts.workspaceId).trim()
      : '';
  if (env?.DB && agentRunId) {
    const colSet = await pragmaTableInfo(env.DB, 'agentsam_agent_run');
    if (colSet.has('external_agent_id')) {
      // Webhook attribution: bc_… → tenant/workspace recorded at spawn (Cursor payload has neither).
      const sets = ['external_agent_id = ?'];
      const binds = [externalId];
      if (colSet.has('tenant_id') && tenantId) {
        sets.push(`tenant_id = CASE WHEN TRIM(COALESCE(tenant_id,'')) = '' THEN ? ELSE tenant_id END`);
        binds.push(tenantId);
      }
      if (colSet.has('workspace_id') && workspaceId) {
        sets.push(
          `workspace_id = CASE WHEN TRIM(COALESCE(workspace_id,'')) = '' THEN ? ELSE workspace_id END`,
        );
        binds.push(workspaceId);
      }
      binds.push(agentRunId);
      await env.DB.prepare(`UPDATE agentsam_agent_run SET ${sets.join(', ')} WHERE id = ?`)
        .bind(...binds)
        .run()
        .catch(() => {});
    }
  }

  return {
    ok: true,
    agentId: externalId,
    runId: externalRunId,
    status: agentData?.run?.status || agentData?.agent?.status || agentData.status || 'running',
    model,
  };
}

/**
 * Parse Cursor v1 SSE (event: + data:) frames from a chunk buffer.
 * @param {string} buffer
 * @returns {{ frames: Array<{ event: string, data: string }>, rest: string }}
 */
function takeCursorSseFrames(buffer) {
  const frames = [];
  const parts = buffer.split('\n\n');
  const rest = parts.pop() || '';
  for (const block of parts) {
    let event = 'message';
    const dataLines = [];
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        event = line.slice(6).trim() || 'message';
        continue;
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length) frames.push({ event, data: dataLines.join('\n') });
  }
  return { frames, rest };
}

/**
 * Map Cursor SSE → OpenAI chat.completions chunks (agent tool loop consumer).
 * @param {ReadableStream<Uint8Array>} upstreamBody
 */
function pipeCursorStreamAsOpenAiChat(upstreamBody) {
  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  (async () => {
    const reader = upstreamBody.getReader();
    const dec = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const { frames, rest } = takeCursorSseFrames(buffer);
        buffer = rest;
        for (const frame of frames) {
          const rawLine = frame.data;
          if (!rawLine || rawLine === '[DONE]') continue;
          try {
            const event = JSON.parse(rawLine);
            const ev = String(frame.event || event.type || '').toLowerCase();
            if (ev === 'assistant' || ev === 'thinking') {
              const text = event.text || event.content || event.delta || '';
              if (text) {
                await writer.write(
                  enc.encode(
                    `data: ${JSON.stringify({
                      choices: [{ delta: { content: String(text) }, finish_reason: null }],
                    })}\n\n`,
                  ),
                );
              }
              continue;
            }
            // Legacy / nested shapes
            const text =
              event.content || event.text || event.delta || event.message || '';
            if (
              text &&
              (event.type === 'text' || event.type === 'message' || event.type === 'delta')
            ) {
              await writer.write(
                enc.encode(
                  `data: ${JSON.stringify({
                    choices: [{ delta: { content: String(text) }, finish_reason: null }],
                  })}\n\n`,
                ),
              );
            }
          } catch {
            /* skip */
          }
        }
      }
      await writer.write(enc.encode('data: [DONE]\n\n'));
    } finally {
      await writer.close();
    }
  })().catch((e) => console.warn('[cursor-agent] openai_sse pipe', e?.message ?? e));

  return readable;
}

/**
 * Map Cursor SSE → agent.stream.* events (dashboard /api/cursor routes).
 * @param {ReadableStream<Uint8Array>} upstreamBody
 */
function pipeCursorStreamAsAgentEvents(upstreamBody) {
  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  (async () => {
    const reader = upstreamBody.getReader();
    const dec = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        const { frames, rest } = takeCursorSseFrames(buffer);
        buffer = rest;
        for (const frame of frames) {
          const raw = frame.data;
          if (!raw || raw === '[DONE]') continue;
          try {
            const event = JSON.parse(raw);
            const ev = String(frame.event || event.type || '').toLowerCase();
            let mapped = null;
            if (ev === 'assistant' || ev === 'thinking' || event.type === 'text' || event.type === 'message') {
              mapped = {
                type: 'agent.stream.delta',
                delta: event.content || event.text || '',
                ts: Date.now(),
              };
            } else if (ev === 'tool_call' || event.type === 'tool_use' || event.type === 'tool_call') {
              const status = String(event.status || '').toLowerCase();
              mapped =
                status === 'completed'
                  ? { type: 'agent.tool.done', tool: event.name || event.tool, ts: Date.now() }
                  : { type: 'agent.tool.start', tool: event.name || event.tool, ts: Date.now() };
            } else if (ev === 'done' || ev === 'result' || event.type === 'done' || event.type === 'complete') {
              mapped = { type: 'agent.stream.done', ts: Date.now() };
            } else if (event.type === 'file_write' || event.type === 'edit') {
              mapped = {
                type: 'agent.file.changed',
                file: event.path || event.file,
                action: event.type,
                ts: Date.now(),
              };
            }
            if (mapped) {
              await writer.write(enc.encode(`data: ${JSON.stringify(mapped)}\n\n`));
            }
          } catch {
            /* skip malformed events */
          }
        }
      }
    } finally {
      await writer.write(
        enc.encode(`data: ${JSON.stringify({ type: 'agent.stream.done', ts: Date.now() })}\n\n`),
      );
      await writer.close();
    }
  })().catch((e) => console.warn('[cursor-agent] agent_events pipe', e?.message ?? e));

  return readable;
}

/**
 * v1 stream is per-run: GET /v1/agents/{agentId}/runs/{runId}/stream
 * @param {any} env
 * @param {string} agentId
 * @param {string|null|undefined} runId
 */
async function fetchCursorAgentStream(env, agentId, runId) {
  const apiKey = resolveCursorApiKey(env);
  if (!apiKey) return null;
  let resolvedRunId = runId != null ? String(runId).trim() : '';
  if (!resolvedRunId) {
    try {
      const st = await fetch(`${CURSOR_API_BASE}/agents/${encodeURIComponent(agentId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (st.ok) {
        const j = await st.json().catch(() => ({}));
        resolvedRunId = String(j?.latestRunId || j?.agent?.latestRunId || j?.run?.id || '').trim();
      }
    } catch {
      /* fall through */
    }
  }
  if (!resolvedRunId) return null;
  return fetch(
    `${CURSOR_API_BASE}/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(resolvedRunId)}/stream`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/event-stream',
      },
    },
  );
}

/**
 * Provider dispatch — used by dispatchStream when api_platform = cursor_sdk.
 * @param {any} env
 * @param {Request} _request
 * @param {Record<string, unknown>} params
 */
export async function dispatchCursorComposerStream(env, _request, params) {
  if (!resolveCursorApiKey(env)) {
    return jsonResponse({ error: 'CURSOR_API_KEY not configured' }, 503);
  }

  const modelKey = String(params.modelKey || 'composer-2.5').trim();
  const rawProviderId =
    params.providerModelId != null && String(params.providerModelId).trim() !== ''
      ? String(params.providerModelId).trim()
      : modelKey;
  // Catalog side-by-side keys use cursor/<api_id> when bare id exists on another provider.
  const providerModelId = rawProviderId.startsWith('cursor/')
    ? rawProviderId.slice('cursor/'.length)
    : rawProviderId;
  const prompt = buildCursorPromptFromChat(params.systemPrompt, params.messages);

  const agentRunId = params.agentRunId ?? params.agent_run_id ?? null;
  const tenantId =
    params.tenantId ?? params.tenant_id ?? params.runContext?.tenantId ?? params.runContext?.tenant_id ?? null;
  const workspaceId =
    params.workspaceId ??
    params.workspace_id ??
    params.runContext?.workspaceId ??
    params.runContext?.workspace_id ??
    null;

  const spawned = await spawnCursorCloudAgent(env, {
    prompt,
    model: providerModelId,
    agentRunId: agentRunId != null ? String(agentRunId) : null,
    tenantId: tenantId != null ? String(tenantId) : null,
    workspaceId: workspaceId != null ? String(workspaceId) : null,
  });
  if (!spawned.ok) {
    return jsonResponse(
      { error: spawned.error, detail: spawned.detail ?? null },
      spawned.status === 400 ? 400 : 502,
    );
  }
  if (env.DB && agentRunId) {
    await env.DB.prepare(
      `UPDATE agentsam_agent_run SET status = 'running', model_id = ? WHERE id = ?`,
    )
      .bind(modelKey, String(agentRunId))
      .run()
      .catch(() => {});
  }

  const upstreamRes = await fetchCursorAgentStream(env, spawned.agentId, spawned.runId);
  if (!upstreamRes?.ok || !upstreamRes.body) {
    return jsonResponse(
      { error: `Cursor stream unavailable: ${upstreamRes?.status ?? 'no_body'}` },
      502,
    );
  }

  const readable = pipeCursorStreamAsOpenAiChat(upstreamRes.body);
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Provider': 'cursor_sdk',
      'X-Cursor-Agent-Id': spawned.agentId,
      'X-Cursor-Run-Id': spawned.runId,
    },
  });
}

export async function handleCursorAgentApi(request, url, env, ctx) {
  const method = request.method.toUpperCase();
  const path = url.pathname.toLowerCase();

  try {
    // Lightweight config + live Cursor /v0/me + webhook HMAC self-check (auth required).
    if (path === '/api/cursor/probe' && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

      const apiKey = resolveCursorApiKey(env);
      const webhookSecret = await resolveCursorWebhookSecret(env);
      const out = {
        ok: false,
        api_key_configured: !!apiKey,
        webhook_secret_configured: !!webhookSecret,
        cursor_me: null,
        webhook_hmac_self_check: null,
        models_sample: null,
      };

      if (!apiKey) {
        return jsonResponse({ ...out, error: 'CURSOR_API_KEY not configured' }, 503);
      }

      const meRes = await fetch('https://api.cursor.com/v0/me', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const meRaw = await meRes.text();
      let meJson = null;
      try {
        meJson = meRaw ? JSON.parse(meRaw) : null;
      } catch {
        meJson = null;
      }
      out.cursor_me = {
        http_status: meRes.status,
        ok: meRes.ok,
        // Never echo secrets; expose only non-sensitive identity fields Cursor returns.
        apiKeyName: meJson?.apiKeyName ?? meJson?.api_key_name ?? null,
        userEmail: meJson?.userEmail ?? meJson?.email ?? null,
      };

      if (meRes.ok) {
        const modelsRes = await fetch('https://api.cursor.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const modelsRaw = await modelsRes.text();
        let modelsJson = null;
        try {
          modelsJson = modelsRaw ? JSON.parse(modelsRaw) : null;
        } catch {
          modelsJson = null;
        }
        const items = Array.isArray(modelsJson?.items)
          ? modelsJson.items
          : Array.isArray(modelsJson?.data)
            ? modelsJson.data
            : [];
        const ids = items.map((m) => m?.id || m?.name).filter(Boolean);
        out.models_sample = {
          http_status: modelsRes.status,
          ok: modelsRes.ok,
          count: ids.length,
          sample: ids.slice(0, 8),
          has_composer_2_5: ids.includes('composer-2.5'),
          has_glm_5_2: ids.includes('glm-5.2'),
          has_grok_4_5: ids.includes('grok-4.5'),
        };
      }

      if (webhookSecret) {
        const probeBody = JSON.stringify({
          event: 'iam_probe',
          ts: Math.floor(Date.now() / 1000),
        });
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey(
          'raw',
          enc.encode(webhookSecret),
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign'],
        );
        const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(probeBody));
        const sigHex = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
        const verifyRes = await fetch(new URL('/api/webhooks/cursor', url.origin).toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': `sha256=${sigHex}`,
            'X-Webhook-Event': 'iam_probe',
            'X-Webhook-ID': `probe_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
          },
          body: probeBody,
        });
        const verifyRaw = await verifyRes.text();
        let verifyJson = null;
        try {
          verifyJson = verifyRaw ? JSON.parse(verifyRaw) : null;
        } catch {
          verifyJson = { raw: verifyRaw.slice(0, 120) };
        }
        out.webhook_hmac_self_check = {
          http_status: verifyRes.status,
          ok: verifyRes.ok || verifyRes.status === 202,
          body: verifyJson,
        };
      } else {
        out.webhook_hmac_self_check = { ok: false, error: 'CURSOR_WEBHOOK_SECRET not configured' };
      }

      out.ok = !!(out.cursor_me?.ok && out.webhook_hmac_self_check?.ok);
      return jsonResponse(out, out.ok ? 200 : 502);
    }

    if (!resolveCursorApiKey(env)) {
      return jsonResponse({ error: 'CURSOR_API_KEY not configured' }, 503);
    }

    if (path === '/api/cursor/agent/spawn' && method === 'POST') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

      const body = await request.json().catch(() => ({}));
      const { plan_id, prompt, repo, branch = 'main', model = 'composer-2.5' } = body;

      if (!prompt) return jsonResponse({ error: 'prompt required' }, 400);

      let tenantId =
        authUser.tenant_id != null && String(authUser.tenant_id).trim() !== ''
          ? String(authUser.tenant_id).trim()
          : null;
      if (!tenantId && authUser.id) {
        tenantId = await fetchAuthUserTenantId(env, authUser.id);
      }
      const workspaceId =
        (authUser.workspace_id != null && String(authUser.workspace_id).trim() !== ''
          ? String(authUser.workspace_id).trim()
          : null) ||
        (authUser.active_workspace_id != null && String(authUser.active_workspace_id).trim() !== ''
          ? String(authUser.active_workspace_id).trim()
          : null);

      let fullPrompt = prompt;
      if (plan_id && env.DB) {
        const plan = await env.DB.prepare('SELECT * FROM agentsam_plans WHERE id = ?').bind(plan_id).first();
        if (plan) {
          const steps = await env.DB.prepare(
            'SELECT title, task_type FROM agentsam_todo WHERE plan_id = ? ORDER BY sort_order',
          )
            .bind(plan_id)
            .all();

          fullPrompt = `${prompt}

Build Plan:
${(steps.results || []).map((s, i) => `${i + 1}. ${s.title}`).join('\n')}

Repository: ${repo || 'current workspace'}
Branch: ${branch}`;
        }
      }

      const agentRunId = 'arun_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      // Insert run *before* spawn so webhook can resolve bc_… → tenant even if Cursor finishes fast.
      if (env.DB) {
        const colSet = await pragmaTableInfo(env.DB, 'agentsam_agent_run');
        const cols = ['id', 'user_id', 'agent_id', 'status', 'trigger', 'model_id', 'conversation_id', 'created_at'];
        const vals = ['?', '?', '?', "'running'", "'cursor_api'", '?', '?', "datetime('now')"];
        const binds = [agentRunId, authUser.id, null, model, plan_id || null];
        if (colSet.has('tenant_id') && tenantId) {
          cols.push('tenant_id');
          vals.push('?');
          binds.push(tenantId);
        }
        if (colSet.has('workspace_id') && workspaceId) {
          cols.push('workspace_id');
          vals.push('?');
          binds.push(workspaceId);
        }
        if (colSet.has('provider')) {
          cols.push('provider');
          vals.push('?');
          binds.push('cursor');
        }
        await env.DB.prepare(
          `INSERT INTO agentsam_agent_run (${cols.join(', ')}) VALUES (${vals.join(', ')})`,
        )
          .bind(...binds)
          .run()
          .catch((e) => console.warn('[cursor-spawn] agent_run insert', e?.message ?? e));
      }

      const spawned = await spawnCursorCloudAgent(env, {
        prompt: fullPrompt,
        model,
        repo,
        branch,
        agentRunId,
        tenantId,
        workspaceId,
      });
      if (!spawned.ok) {
        return jsonResponse(
          { error: spawned.error, detail: spawned.detail ?? null },
          spawned.status === 400 ? 400 : 502,
        );
      }

      return jsonResponse({
        agent_id: spawned.agentId,
        run_id: spawned.runId,
        status: spawned.status || 'running',
        stream_url: `/api/cursor/agent/${spawned.agentId}/stream?run_id=${encodeURIComponent(spawned.runId)}`,
        model,
      });
    }

    const streamMatch = url.pathname.match(/^\/api\/cursor\/agent\/([^/]+)\/stream$/i);
    if (streamMatch && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

      const agentId = streamMatch[1];
      const runId = url.searchParams.get('run_id') || url.searchParams.get('runId') || null;
      const upstreamRes = await fetchCursorAgentStream(env, agentId, runId);
      if (!upstreamRes?.ok || !upstreamRes.body) {
        return jsonResponse({ error: `Stream unavailable: ${upstreamRes?.status ?? 'no_body'}` }, 502);
      }

      const readable = pipeCursorStreamAsAgentEvents(upstreamRes.body);
      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    const statusMatch = url.pathname.match(/^\/api\/cursor\/agent\/([^/]+)\/status$/i);
    if (statusMatch && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

      const agentId = statusMatch[1];
      const apiKey = resolveCursorApiKey(env);

      const statusRes = await fetch(`${CURSOR_API_BASE}/agents/${agentId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!statusRes.ok) {
        return jsonResponse({ error: `Status unavailable: ${statusRes.status}` }, 502);
      }

      const raw = await statusRes.text();
      let data;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        return jsonResponse({ error: 'Invalid status response from Cursor' }, 502);
      }
      return jsonResponse({
        agent_id: agentId,
        status: data.status,
        artifacts: data.artifacts || [],
        created_at: data.created_at,
        completed_at: data.completed_at,
      });
    }

    if (path === '/api/cursor/agents' && method === 'GET') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

      const apiKey = resolveCursorApiKey(env);
      const listRes = await fetch(`${CURSOR_API_BASE}/agents?limit=20`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!listRes.ok) return jsonResponse({ agents: [] });
      const raw = await listRes.text();
      let data;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        return jsonResponse({ agents: [] });
      }
      return jsonResponse({ agents: data.agents || data.data || [] });
    }

    const cancelMatch = url.pathname.match(/^\/api\/cursor\/agent\/([^/]+)\/cancel$/i);
    if (cancelMatch && method === 'DELETE') {
      const authUser = await getAuthUser(request, env);
      if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

      const agentId = cancelMatch[1];
      const apiKey = resolveCursorApiKey(env);
      await fetch(`${CURSOR_API_BASE}/agents/${agentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      return jsonResponse({ ok: true, agent_id: agentId, status: 'cancelled' });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (e) {
    console.warn('[handleCursorAgentApi]', e?.message ?? e);
    return jsonResponse({ error: String(e?.message || e) }, 500);
  }
}
