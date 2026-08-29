/**
 * Browser capability adapter — catalog dispatch + trusted-origin checks only.
 */
import { dispatchCatalogToolResult } from '../../../backend/http/agentsam/routes/dispatch-by-tool-code.js';
import { assertBrowserTrustedOrigin } from '../agentsam-ops-ledger.js';
import {
  loadAvailableToolsForCapability,
  toolRequiresApproval,
  isTrustedBrowserReadTool,
} from '../tool-registry.js';

function extractUrl(message, browserContext) {
  const m = String(message || '');
  const fromMsg = m.match(/https?:\/\/[^\s)>'"<]+/i);
  if (fromMsg) return fromMsg[0].replace(/[.,;]+$/, '');
  const u = browserContext && typeof browserContext === 'object' ? browserContext.url : null;
  return u != null && String(u).trim() ? String(u).trim() : '';
}

function pickTool(registryRows, candidates) {
  const set = new Set(registryRows.map((r) => String(r.tool_name)));
  for (const c of candidates) {
    if (set.has(c)) return c;
  }
  return null;
}

function toolResultOk(res) {
  if (!res || typeof res !== 'object') return false;
  if (res.blocked) return false;
  if (res.error && String(res.error).trim()) return false;
  if (res.ok === false) return false;
  return true;
}

/**
 * @param {object} p
 * @param {any} p.env
 * @param {string} p.runId
 * @param {string} p.tenantId
 * @param {string} p.workspaceId
 * @param {string} p.userId
 * @param {string} p.message
 * @param {Record<string, unknown>|null} p.browserContext
 * @param {string} [p.workflowKey]
 * @param {(type: string, payload: Record<string, unknown>) => void} p.emit
 */
export async function runBrowserCapabilityAction(p) {
  const { env, runId, tenantId, workspaceId, userId, message, browserContext, emit } = p;
  const workflowKey = p.workflowKey != null ? String(p.workflowKey).trim() : null;
  const stepResults = [];
  let stepsDone = 0;
  const stepsTotal = 6;

  const pushStep = (key, payload) => {
    stepsDone += 1;
    stepResults.push({ step: key, at: new Date().toISOString(), ...payload });
    emit('workflow_step', {
      run_id: runId,
      node_key: key,
      current_node_key: key,
      steps_completed: stepsDone,
      steps_total: stepsTotal,
      cost_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
      ok: payload.ok !== false,
    });
  };

  const url = extractUrl(message, browserContext);
  if (!url) {
    return {
      ok: false,
      error: 'no_target_url',
      step_results: stepResults,
      output: { error: 'No URL in message or browserContext.url' },
    };
  }

  try {
    await assertBrowserTrustedOrigin(env, { userId, workspaceId, origin: url });
  } catch (e) {
    const msg = e?.message != null ? String(e.message) : String(e);
    pushStep('trusted_origin_gate', { ok: false, error: msg, tool: null });
    return {
      ok: false,
      error: msg,
      step_results: stepResults,
      output: { error: msg, url },
    };
  }

  const registry = await loadAvailableToolsForCapability(env, tenantId, workspaceId, userId, 'browser');
  const session = { user_id: userId, workspace_id: workspaceId, workspaceId };
  const baseParams = {
    url,
    user_id: userId,
    workspace_id: workspaceId,
    session,
    agent_run_id: runId,
    ...(browserContext?.browser_session_id != null
      ? { browser_session_id: String(browserContext.browser_session_id).trim() }
      : browserContext?.browserSessionId != null
        ? { browser_session_id: String(browserContext.browserSessionId).trim() }
        : {}),
    ...(workflowKey ? { workflow_run_id: runId } : {}),
  };

  const navigateName = pickTool(registry, ['browser_navigate', 'cdt_navigate_page']);
  const contentName = pickTool(registry, ['browser_content']);
  const shotName = pickTool(registry, ['playwright_screenshot', 'browser_screenshot']);

  if (!navigateName) {
    pushStep('registry', {
      ok: false,
      error: 'browser_navigate not available in agentsam_tools for this workspace',
    });
    return {
      ok: false,
      error: 'missing_browser_navigate_registry',
      step_results: stepResults,
      output: { url, registry_miss: true },
    };
  }

  const gateApproval = (name) => {
    if (isTrustedBrowserReadTool(name)) return false;
    const row = registry.find((r) => r.tool_name === name);
    return toolRequiresApproval(name, row || null);
  };

  if (gateApproval(navigateName)) {
    pushStep('approval', { ok: false, error: 'approval_required', tool: navigateName });
    return {
      ok: false,
      error: 'approval_required',
      step_results: stepResults,
      output: { url, blocked_tool: navigateName },
    };
  }

  const surfacePayload = {
    surface: 'browser',
    reason: 'workspace_capability_browser',
    url,
    run_id: runId,
    workflow_key: workflowKey,
  };
  console.log('[browser-capability] surface_open', JSON.stringify({ url, runId }));
  emit('surface_open', surfacePayload);
  emit('agent_surface_open', { ...surfacePayload });
  const navRes = await dispatchCatalogToolResult(env, navigateName, baseParams, {
    tenantId,
    workspaceId,
    userId,
    workflow_run_id: workflowKey ? runId : null,
  });
  emit('browser_navigate', {
    url: toolResultOk(navRes) && navRes?.url ? String(navRes.url) : url,
    run_id: runId,
    workflow_key: workflowKey,
    screenshot_url: navRes?.screenshot_url != null ? String(navRes.screenshot_url) : undefined,
    page_text: navRes?.page_text != null ? String(navRes.page_text) : undefined,
    title: navRes?.title != null ? String(navRes.title) : undefined,
  });
  pushStep('navigate', {
    ok: toolResultOk(navRes),
    tool: navigateName,
    result: navRes,
  });
  if (!toolResultOk(navRes)) {
    return {
      ok: false,
      error: String(navRes?.error || 'navigate_failed'),
      step_results: stepResults,
      output: { url, navigate: navRes },
    };
  }

  let contentRes = null;
  if (contentName && !gateApproval(contentName)) {
    contentRes = await dispatchCatalogToolResult(env, contentName, baseParams, {
      tenantId,
      workspaceId,
      userId,
    });
    pushStep('content', {
      ok: toolResultOk(contentRes),
      tool: contentName,
      result: contentRes,
    });
  } else {
    pushStep('content', {
      ok: true,
      skipped: true,
      reason: contentName ? 'approval_or_unlisted' : 'browser_content not in registry',
    });
  }

  let shotRes = null;
  if (shotName && !gateApproval(shotName)) {
    shotRes = await dispatchCatalogToolResult(env, shotName, baseParams, {
      tenantId,
      workspaceId,
      userId,
    });
    pushStep('screenshot', {
      ok: toolResultOk(shotRes),
      tool: shotName,
      result: shotRes,
    });
  } else {
    pushStep('screenshot', {
      ok: true,
      skipped: true,
      reason: shotName ? 'approval_or_unlisted' : 'screenshot tool not in registry',
    });
  }

  const html =
    contentRes && typeof contentRes.html === 'string'
      ? contentRes.html
      : contentRes && typeof contentRes.text === 'string'
        ? contentRes.text
        : null;
  const excerpt =
    html != null
      ? html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000)
      : null;

  const output = {
    url,
    title: contentRes?.title ?? null,
    content_excerpt: excerpt,
    screenshot_url: shotRes?.screenshot_url ?? shotRes?.url ?? null,
    navigate: navRes,
    content: contentRes,
    screenshot: shotRes,
  };

  pushStep('summary_inputs', {
    ok: true,
    excerpt_length: excerpt ? excerpt.length : 0,
    has_screenshot: !!(output.screenshot_url || shotRes?.ok),
  });

  return {
    ok: true,
    step_results: stepResults,
    output,
    artifact_for_model: {
      capability: 'browser',
      url,
      visible_text_excerpt: excerpt,
      screenshot_url: output.screenshot_url,
      tool_errors: stepResults.filter((s) => s.ok === false).map((s) => s.error || s.step),
    },
  };
}
