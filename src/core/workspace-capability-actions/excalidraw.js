/**
 * Minimal Excalidraw adapter — open surface, structured scene in output, optional builtin tools.
 */
import { dispatchCatalogToolResult } from '../../../backend/http/agentsam/routes/dispatch-by-tool-code.js';
import { loadAvailableToolsForCapability, toolRequiresApproval } from '../tool-registry.js';

import { buildWireframeExcalidrawScene } from '../../core/iam-wireframe-excalidraw-scene.js';

function buildScene(message) {
  const msg = String(message || '').trim();
  if (/\bwireframe\b/i.test(msg) || /\b(lo-?fi|sketch).*(flow|screen|ui|ux)\b/i.test(msg)) {
    return buildWireframeExcalidrawScene({
      title: msg.slice(0, 80) || 'Wireframe',
      brief: msg,
      intent: 'wireframe',
    });
  }
  return buildSimpleScene(message);
}

function buildSimpleScene(message) {
  const idBase = () => `cap_${Math.random().toString(36).slice(2, 10)}`;
  const title = String(message || '').slice(0, 80) || 'Workspace diagram';
  return {
    type: 'excalidraw',
    version: 2,
    source: 'workspace_capability_runtime',
    elements: [
      {
        id: idBase(),
        type: 'rectangle',
        x: 80,
        y: 80,
        width: 420,
        height: 72,
        strokeColor: '#1e1e1e',
        backgroundColor: '#e3f2fd',
        fillStyle: 'solid',
        strokeWidth: 2,
        roughness: 1,
        opacity: 100,
        seed: Math.floor(Math.random() * 1e9),
        versionNonce: Math.floor(Math.random() * 1e9),
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
      },
      {
        id: idBase(),
        type: 'text',
        x: 100,
        y: 100,
        width: 380,
        height: 40,
        text: title,
        fontSize: 22,
        fontFamily: 1,
        textAlign: 'center',
        verticalAlign: 'middle',
        strokeColor: '#1e1e1e',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        strokeWidth: 1,
        roughness: 1,
        opacity: 100,
        seed: Math.floor(Math.random() * 1e9),
        versionNonce: Math.floor(Math.random() * 1e9),
        isDeleted: false,
        boundElements: null,
        updated: Date.now(),
        link: null,
        locked: false,
      },
    ],
    appState: { viewBackgroundColor: '#ffffff' },
    files: {},
  };
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
export async function runExcalidrawCapabilityAction(p) {
  const { env, runId, tenantId, workspaceId, userId, message, emit } = p;
  const stepResults = [];
  let stepsDone = 0;
  const stepsTotal = 5;

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

  emit('surface_open', { surface: 'excalidraw', reason: 'workspace_capability_excalidraw' });
  emit('agent_surface_open', { surface: 'excalidraw', reason: 'workspace_capability_excalidraw' });

  const scene = buildScene(message);
  const registry = await loadAvailableToolsForCapability(env, tenantId, workspaceId, userId, 'excalidraw');

  const has = (n) =>
    registry.some((r) => {
      const nm = String(r.tool_name || r.tool_key || '').trim();
      return nm === n;
    });

  const { handlers: mediaHandlers } = await import('../../../backend/agentsam/tools/media.js');

  let openRes = null;
  const openCatalogKey = has('agentsam_excalidraw')
    ? 'agentsam_excalidraw'
    : has('excalidraw_open')
      ? 'excalidraw_open'
      : null;
  if (
    openCatalogKey &&
    !toolRequiresApproval(openCatalogKey, registry.find((r) => r.tool_name === openCatalogKey))
  ) {
    openRes = await dispatchCatalogToolResult(
      env,
      openCatalogKey,
      {
        user_id: userId,
        workspace_id: workspaceId,
        session: { user_id: userId, workspace_id: workspaceId },
      },
      { tenantId, workspaceId, userId },
    );
  }
  pushStep('agentsam_excalidraw', {
    ok: !openRes?.error,
    tool: openCatalogKey || 'agentsam_excalidraw',
    result: openRes,
    skipped: !openCatalogKey,
  });

  // Private adapter path — excalidraw_add_elements is NOT a model-facing catalog tool.
  let addRes = null;
  try {
    addRes = await mediaHandlers.excalidraw_add_elements(
      {
        elements: scene.elements,
        user_id: userId,
        workspace_id: workspaceId,
        session: { user_id: userId, workspace_id: workspaceId },
      },
      env,
    );
  } catch (e) {
    addRes = { error: e?.message != null ? String(e.message) : String(e) };
  }
  pushStep('excalidraw_add_elements_private', {
    ok: !addRes?.error,
    tool: 'excalidraw_add_elements',
    result: addRes,
    element_count: scene.elements.length,
    skipped: false,
    private_handler: true,
  });

  let exportRes = null;
  if (
    has('excalidraw_export') &&
    !toolRequiresApproval('excalidraw_export', registry.find((r) => r.tool_name === 'excalidraw_export'))
  ) {
    exportRes = await dispatchCatalogToolResult(
      env,
      'excalidraw_export',
      {
        scene,
        user_id: userId,
        workspace_id: workspaceId,
        session: { user_id: userId, workspace_id: workspaceId },
      },
      { tenantId, workspaceId, userId },
    );
  }
  pushStep('excalidraw_export', {
    ok: !exportRes?.error,
    tool: 'excalidraw_export',
    result: exportRes,
    skipped: !has('excalidraw_export'),
  });

  const output = {
    scene,
    open: openRes,
    add: addRes,
    export: exportRes,
  };

  return {
    ok: true,
    step_results: stepResults,
    output,
    artifact_for_model: {
      capability: 'excalidraw',
      scene_summary: { element_count: scene.elements.length, title: String(message).slice(0, 120) },
      tool_notes: stepResults.filter((s) => s.skipped).map((s) => s.step),
    },
  };
}
