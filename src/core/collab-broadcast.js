/**
 * IAM_COLLAB canvas room broadcasts for agent-driven Excalidraw + Monaco sync.
 * Non-throwing — collab fanout must never fail tool execution.
 */

/**
 * @param {any} env
 * @param {string} workspaceId
 * @param {Record<string, unknown>} message
 */
export async function broadcastToCollabCanvas(env, workspaceId, message) {
  if (!env?.IAM_COLLAB || !workspaceId || !message || typeof message !== 'object') return;
  try {
    const roomName = `canvas:${String(workspaceId).trim()}`;
    if (!roomName || roomName === 'canvas:') return;
    const id = env.IAM_COLLAB.idFromName(roomName);
    const stub = env.IAM_COLLAB.get(id);
    await stub.fetch(
      new Request('https://do/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      }),
    );
  } catch (e) {
    console.warn('[collab-broadcast] failed', e?.message ?? e);
  }
}

/**
 * @param {any} env
 * @param {string} workspaceId
 * @param {string} action
 * @param {Record<string, unknown>} [params]
 */
export async function broadcastExcalidrawAction(env, workspaceId, action, params = {}) {
  const act = String(action || '').trim();
  if (!act) return;
  await broadcastToCollabCanvas(env, workspaceId, {
    type: 'iam_excalidraw',
    action: act,
    params: params && typeof params === 'object' ? params : {},
  });
}

/**
 * Persist full canvas elements in DO storage and fan out canvas_update.
 * @param {any} env
 * @param {string} workspaceId
 * @param {unknown[]} elements
 */
export async function persistCollabCanvasElements(env, workspaceId, elements) {
  if (!env?.IAM_COLLAB || !workspaceId || !Array.isArray(elements)) return;
  try {
    const roomName = `canvas:${String(workspaceId).trim()}`;
    const id = env.IAM_COLLAB.idFromName(roomName);
    const stub = env.IAM_COLLAB.get(id);
    await stub.fetch(
      new Request('https://do/canvas/elements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elements }),
      }),
    );
  } catch (e) {
    console.warn('[collab-broadcast] persist canvas elements', e?.message ?? e);
  }
}

/**
 * @param {string} filePath
 * @param {string} before
 * @param {string} after
 */
export function buildUnifiedDiffPatch(filePath, before, after) {
  const path = String(filePath || 'file').trim() || 'file';
  const beforeText = String(before ?? '');
  const afterText = String(after ?? '');
  if (beforeText === afterText) return '';
  const beforeLines = beforeText.split('\n');
  const afterLines = afterText.split('\n');
  const header = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${Math.max(beforeLines.length, 1)} +1,${Math.max(afterLines.length, 1)} @@`,
  ];
  const body = [
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
  ];
  return [...header, ...body].join('\n');
}

/**
 * @param {any} env
 * @param {string} workspaceId
 * @param {string} filePath
 * @param {string} patch
 */
export async function broadcastMonacoPatch(env, workspaceId, filePath, patch) {
  const fp = String(filePath || '').trim();
  const p = String(patch || '').trim();
  if (!fp || !p) return;
  await broadcastToCollabCanvas(env, workspaceId, {
    type: 'iam_monaco_patch',
    filePath: fp,
    patch: p,
  });
}

/**
 * @param {any} env
 * @param {string} workspaceId
 * @param {string} toolOutput
 */
export async function tryBroadcastMonacoPatchFromToolOutput(env, workspaceId, toolOutput) {
  if (!workspaceId) return;
  let parsed;
  try {
    parsed = JSON.parse(String(toolOutput || 'null'));
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;
  const path =
    (typeof parsed.path === 'string' && parsed.path.trim()) ||
    (typeof parsed.file_path === 'string' && parsed.file_path.trim()) ||
    (typeof parsed.file === 'string' && parsed.file.trim()) ||
    (Array.isArray(parsed.files_touched) && typeof parsed.files_touched[0] === 'string'
      ? String(parsed.files_touched[0]).trim()
      : '');
  const before =
    typeof parsed.before === 'string'
      ? parsed.before
      : typeof parsed.content_before === 'string'
        ? parsed.content_before
        : typeof parsed.original === 'string'
          ? parsed.original
          : typeof parsed.original_content === 'string'
            ? parsed.original_content
            : null;
  const after =
    typeof parsed.after === 'string'
      ? parsed.after
      : typeof parsed.content_after === 'string'
        ? parsed.content_after
        : typeof parsed.modified === 'string'
          ? parsed.modified
          : typeof parsed.patched_content === 'string'
            ? parsed.patched_content
            : typeof parsed.content === 'string'
              ? parsed.content
              : null;
  if (!path || before == null || after == null || before === after) return;
  const patch = buildUnifiedDiffPatch(path, before, after);
  if (!patch) return;
  await broadcastMonacoPatch(env, workspaceId, path.slice(0, 500), patch);
}

/**
 * Resolve workspace_id from tool params / session envelope.
 * @param {Record<string, unknown>} [params]
 */
export function resolveCollabWorkspaceId(params = {}) {
  const p = params && typeof params === 'object' ? params : {};
  const session = p.session && typeof p.session === 'object' ? p.session : {};
  return String(
    p.workspace_id ??
      p.workspaceId ??
      session.workspace_id ??
      session.workspaceId ??
      '',
  ).trim();
}
