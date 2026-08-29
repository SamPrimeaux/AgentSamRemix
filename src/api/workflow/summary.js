/**
 * Daily rollup — model resolved from DB, never hardcoded.
 */
import { fallbackSystemTenantId } from '../../core/auth.js';
import { dispatchComplete } from '../../../backend/agentsam/runtime/provider-dispatch.js';

export async function generateDailySummaryEmail(env) {
  const startMs = Date.now();
  const today   = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  try {
    // 1. Resolve model from agentsam_model_catalog, then routing_arms
    let modelId = null, provider = 'anthropic', maxTokens = 4096;
    const catalogRow = await env.DB.prepare(`
      SELECT model_key, provider, max_output_tokens
      FROM agentsam_model_catalog
      WHERE COALESCE(is_active, 1) = 1
        AND COALESCE(supports_tools, 0) = 1
      ORDER BY COALESCE(cost_per_1k_in, 9999) ASC, display_name ASC
      LIMIT 1
    `).first().catch(() => null);

    if (catalogRow?.model_key) {
      modelId = catalogRow.model_key;
      provider = catalogRow.provider || provider;
      maxTokens = catalogRow.max_output_tokens || 4096;
    }

    if (!modelId) {
      const r = await env.DB.prepare(`
        SELECT model_key, provider FROM agentsam_routing_arms
        WHERE is_active=1 ORDER BY priority DESC LIMIT 1
      `).first().catch(() => null);
      if (r) { modelId = r.model_key; provider = r.provider || provider; }
    }

    if (!modelId) throw new Error('No model resolved from DB');

    // 2. Aggregate live tables only
    const safe = async (p) => { try { return await p; } catch (_) { return { results: [] }; } };
    const safeFirst = async (p) => { try { return await p; } catch (_) { return null; } };

    const [aiUsage, toolLog, mcpCalls, mcpAudit, deploys] = await Promise.all([
      safeFirst(env.DB.prepare(`
        SELECT COUNT(*) as calls, SUM(tokens_input) as tin,
               SUM(tokens_output) as tout, SUM(cost_estimate) as cost,
               GROUP_CONCAT(DISTINCT model) as models,
               GROUP_CONCAT(DISTINCT provider) as providers
        FROM agentsam_usage_events WHERE date=?
      `).bind(yesterday).first()),

      safeFirst(env.DB.prepare(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as ok,
               SUM(CASE WHEN status='error'   THEN 1 ELSE 0 END) as err
        FROM agentsam_tool_call_log
        WHERE created_at >= unixepoch(?) AND created_at < unixepoch(?)
      `).bind(yesterday, today).first()),

      safeFirst(env.DB.prepare(`
        SELECT COUNT(*) as total, GROUP_CONCAT(DISTINCT tool_name) as tools
        FROM agentsam_mcp_tool_execution
        WHERE created_at >= unixepoch(?) AND created_at < unixepoch(?)
      `).bind(yesterday, today).first()),

      safeFirst(env.DB.prepare(`
        SELECT COUNT(*) as total FROM agentsam_mcp_tool_execution
        WHERE created_at >= unixepoch(?) AND created_at < unixepoch(?)
      `).bind(yesterday, today).first()),

      safeFirst(env.DB.prepare(`
        SELECT COUNT(*) as total,
               SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as ok,
               SUM(CASE WHEN status='failed'    THEN 1 ELSE 0 END) as fail,
               GROUP_CONCAT(DISTINCT worker_name) as workers
        FROM deployment_tracking WHERE created_at >= ? AND created_at < ?
      `).bind(yesterday, today).first()),
    ]);

    // 3. AI narrative
    const ctx = `Date: ${yesterday}
AI calls: ${aiUsage?.calls||0} | Tokens in: ${aiUsage?.tin||0} out: ${aiUsage?.tout||0} | Cost: $${(aiUsage?.cost||0).toFixed(4)}
Models: ${aiUsage?.models||'none'} | Providers: ${aiUsage?.providers||'none'}
Tool calls: ${toolLog?.total||0} (${toolLog?.ok||0} ok / ${toolLog?.err||0} errors)
MCP calls: ${mcpCalls?.total||0} | MCP audit: ${mcpAudit?.total||0}
Deploys: ${deploys?.total||0} (${deploys?.ok||0} ok / ${deploys?.fail||0} failed) workers: ${deploys?.workers||'none'}`;

    const prompt = `You are Agent Sam. Write a concise daily ops summary for the platform operator. Be direct, flag anomalies, no fluff. Do not invent or address a specific person by name.\n\n${ctx}`;

    let summaryText = '';
    if (provider === 'anthropic' && env.ANTHROPIC_API_KEY) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type':'application/json','x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01' },
        body: JSON.stringify({ model: modelId, max_tokens: maxTokens, messages: [{ role:'user', content: prompt }] }),
      });
      const d = await r.json().catch(() => ({}));
      summaryText = d.content?.find(b => b.type==='text')?.text || '';
    } else if (env.OPENAI_API_KEY || env.OPENAI_API_BASE_URL) {
      try {
        const result = await dispatchComplete(env, {
          modelKey: modelId,
          systemPrompt: 'You are Agent Sam.',
          messages: [{ role: 'user', content: prompt }],
          tools: [],
          userId:
            typeof env?.SYSTEM_ACTOR_ID === 'string' && env.SYSTEM_ACTOR_ID.trim()
              ? env.SYSTEM_ACTOR_ID.trim()
              : null,
          options: { reasoningEffort: 'none', verbosity: 'low' },
        });
        summaryText =
          (typeof result?.text === 'string' && result.text) ||
          result?.choices?.[0]?.message?.content ||
          result?.output_text ||
          '';
      } catch (e) {
        console.warn('[daily-summary] dispatchComplete', e?.message ?? e);
        summaryText = '';
      }
    }

    if (!summaryText) summaryText = 'AI unavailable — raw stats above.';

    // 4. Send email
    const to = agentRow?.user_email || env.RESEND_TO || 'info@inneranimals.com';
    const html = `<div style="background:#0a0a0a;color:#e0e0e0;font-family:system-ui,sans-serif;padding:24px;max-width:600px">
<h2 style="color:#4ade80">Agent Sam — ${yesterday}</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px">
<tr><td style="padding:4px 8px;color:#888">AI calls</td><td style="padding:4px 8px"><b>${aiUsage?.calls||0}</b></td><td style="padding:4px 8px;color:#888">Cost</td><td style="padding:4px 8px"><b>$${(aiUsage?.cost||0).toFixed(4)}</b></td></tr>
<tr><td style="padding:4px 8px;color:#888">Tool calls</td><td style="padding:4px 8px"><b>${toolLog?.total||0}</b> (${toolLog?.err||0} errors)</td><td style="padding:4px 8px;color:#888">MCP</td><td style="padding:4px 8px"><b>${mcpCalls?.total||0}</b></td></tr>
<tr><td style="padding:4px 8px;color:#888">Deploys</td><td style="padding:4px 8px"><b>${deploys?.total||0}</b> (${deploys?.fail||0} failed)</td><td style="padding:4px 8px;color:#888">Workers</td><td style="padding:4px 8px">${deploys?.workers||'—'}</td></tr>
</table>
<hr style="border-color:#333">
<div style="white-space:pre-wrap;line-height:1.6">${summaryText}</div>
<hr style="border-color:#333">
<small style="color:#555">Model: ${modelId} | ${new Date().toISOString()}</small>
</div>`;

    const from =
      typeof env.RESEND_FROM === 'string' && env.RESEND_FROM.trim() ? env.RESEND_FROM.trim() : '';
    if (env.RESEND_API_KEY && from) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type':'application/json','Authorization':`Bearer ${env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from,
          to: [to],
          subject: `[Agent Sam] ${yesterday} — ${aiUsage?.calls||0} AI calls · $${(aiUsage?.cost||0).toFixed(4)} · ${deploys?.total||0} deploys`,
          html,
        }),
      });
    }

    // 5. Write R2 snapshot
    await env.ASSETS.put(`analytics/runs/${yesterday}.json`,
      JSON.stringify({ date:yesterday, model:modelId, aiUsage, toolLog, mcpCalls, mcpAudit, deploys, summary:summaryText },null,2),
      { httpMetadata:{ contentType:'application/json' } }
    ).catch(() => {});

    // 6. Log
    const ms = Date.now() - startMs;
    await env.DB.prepare(`
      INSERT INTO agentsam_tool_call_log
        (tenant_id, tool_key, status, duration_ms, tool_category, user_id, created_at_unix)
      VALUES (?,'generate_daily_summary_email','success',?,'workflow',?,unixepoch())
    `).bind(
      fallbackSystemTenantId(env),
      ms,
      (typeof env?.SYSTEM_ACTOR_ID === 'string' && env.SYSTEM_ACTOR_ID.trim()) ? env.SYSTEM_ACTOR_ID.trim() : null,
    ).run().catch((e) => console.warn('[daily-summary tool_call_log]', e?.message ?? e));

  } catch (err) {
    console.error('[daily-summary]', err?.message ?? err);
    await env.DB.prepare(`
      INSERT INTO agentsam_tool_call_log
        (tenant_id,tool_key,status,error_message,tool_category,user_id,created_at_unix)
      VALUES (?,'generate_daily_summary_email','error',?,'workflow',?,unixepoch())
    `).bind(
      fallbackSystemTenantId(env),
      err?.message ?? String(err),
      (typeof env?.SYSTEM_ACTOR_ID === 'string' && env.SYSTEM_ACTOR_ID.trim()) ? env.SYSTEM_ACTOR_ID.trim() : null,
    ).run().catch((e) => console.warn('[daily-summary tool_call_log]', e?.message ?? e));
  }
}
