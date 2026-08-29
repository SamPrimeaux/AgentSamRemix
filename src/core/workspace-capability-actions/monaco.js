/**
 * Minimal Monaco / code-surface adapter — UI open + draft artifact only (no silent repo writes).
 */
import { loadAvailableToolsForCapability, toolRequiresApproval } from '../tool-registry.js';
import { dispatchCatalogToolResult } from '../../../backend/http/agentsam/routes/dispatch-by-tool-code.js';

function guessLanguage(path) {
  const p = String(path || '').toLowerCase();
  if (p.endsWith('.tsx')) return 'typescriptreact';
  if (p.endsWith('.ts')) return 'typescript';
  if (p.endsWith('.jsx')) return 'javascriptreact';
  if (p.endsWith('.js') || p.endsWith('.mjs')) return 'javascript';
  if (p.endsWith('.css')) return 'css';
  if (p.endsWith('.html')) return 'html';
  if (p.endsWith('.json')) return 'json';
  if (p.endsWith('.md')) return 'markdown';
  return 'plaintext';
}

function extractPathHint(message) {
  const m = String(message || '');
  const quoted = m.match(/[`'"]([/][^`'"]+)[`'"]/);
  if (quoted) return quoted[1];
  const loose = m.match(/\b(?:src|dashboard|scripts)\/[a-zA-Z0-9_./-]+\.[a-z]{1,6}\b/);
  return loose ? loose[0] : 'drafts/workspace-capability-draft.txt';
}

/**
 * @param {object} p
 * @param {any} p.env
 * @param {string} p.runId
 * @param {string} p.tenantId
 * @param {string} p.workspaceId
 * @param {string} p.userId
 * @param {string} p.message
 * @param {(type: string, payload: Record<string, unknown>) => void} p.emit
 */
export async function runMonacoCapabilityAction(p) {
  const { env, runId, tenantId, workspaceId, userId, message, emit } = p;
  const stepResults = [];
  let stepsDone = 0;
  const stepsTotal = 4;

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

  emit('surface_open', { surface: 'code', reason: 'workspace_capability_monaco' });
  emit('agent_surface_open', { surface: 'code', reason: 'workspace_capability_monaco' });

  const targetPath = extractPathHint(message);
  const language = guessLanguage(targetPath);

  const registry = await loadAvailableToolsForCapability(env, tenantId, workspaceId, userId, 'monaco');
  const writeCandidates = ['r2_write'];
  const writeTool = writeCandidates.find((n) => registry.some((r) => r.tool_name === n));

  let pendingWrite = true;
  let writeResult = null;

  const explicitWrite =
    /\b(write|save|persist)\b.*\b(file|repo|disk|r2)\b|\bwrite (this|the code) to\b|\bsave (this|the file)\b/i.test(
      String(message || ''),
    );

  if (
    explicitWrite &&
    writeTool &&
    !toolRequiresApproval(writeTool, registry.find((r) => r.tool_name === writeTool))
  ) {
    pendingWrite = false;
    try {
      writeResult = await dispatchCatalogToolResult(env, writeTool, {
        user_id: userId,
        workspace_id: workspaceId,
        path: targetPath,
        content: `// Draft from workspace capability runtime\n// User message (trimmed):\n// ${String(message).slice(0, 2000)}\n`,
        session: { user_id: userId, workspace_id: workspaceId },
      }, { tenantId, workspaceId, userId });
    } catch (e) {
      writeResult = { error: e?.message || String(e) };
      pendingWrite = true;
    }
  }

  const draftBody = [
    `# Draft: ${targetPath}`,
    '',
    '```',
    String(message).slice(0, 12000),
    '```',
  ].join('\n');

  pushStep('monaco_open', {
    ok: true,
    intended_path: targetPath,
    language,
    pending_write: pendingWrite,
    write_tool: writeTool || null,
    write_attempt: writeResult,
  });

  pushStep('monaco_draft', {
    ok: true,
    content_chars: draftBody.length,
    diff_preview: draftBody.slice(0, 4000),
  });

  const output = {
    surface: 'code',
    path: targetPath,
    language,
    draft_markdown: draftBody,
    pending_write: pendingWrite,
    write_tool_attempted: writeTool || null,
    write_result: writeResult,
  };

  return {
    ok: true,
    step_results: stepResults,
    output,
    artifact_for_model: {
      capability: 'monaco',
      ...output,
    },
  };
}
