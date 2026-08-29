/**
 * Persist OpenAI hosted-shell container_id for one agent run (container_reference).
 * Durable container id for one agent run — runContext rebuilds per dispatch.
 */

/**
 * @param {Record<string, unknown>|null|undefined} runContext
 */
export function openaiContainerScopeKey(runContext) {
  if (!runContext || typeof runContext !== 'object') return '';
  return (
    String(runContext.agent_run_id || runContext.agentRunId || '').trim() ||
    String(runContext.sessionId || runContext.session_id || runContext.conversation_id || '').trim()
  );
}

function pinBag(runContext) {
  if (!runContext || typeof runContext !== 'object') return null;
  const bag = runContext.openaiContainerPin;
  if (bag && typeof bag === 'object') return bag;
  return null;
}

/**
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} runContext
 */
export async function resolveOpenaiContainerId(env, runContext) {
  const bag = pinBag(runContext);
  if (bag) {
    const id = String(bag.container_id || '').trim();
    if (id) return id;
  }
  const legacy = String(runContext?.openai_container_id || '').trim();
  if (legacy) return legacy;

  const scope = openaiContainerScopeKey(runContext);
  if (!scope || !env?.DB) return null;
  try {
    const row = await env.DB.prepare(
      `SELECT container_id FROM agentsam_openai_container_pin WHERE agent_run_id = ? LIMIT 1`,
    )
      .bind(scope)
      .first();
    const id = String(row?.container_id || '').trim();
    if (!id) return null;
    if (bag) bag.container_id = id;
    return id;
  } catch (e) {
    console.warn('[openai-container-pin] resolve_failed', e?.message || e);
    return null;
  }
}

/**
 * @param {any} env
 * @param {Record<string, unknown>|null|undefined} runContext
 * @param {string|null|undefined} containerId
 */
export async function pinOpenaiContainerId(env, runContext, containerId) {
  const id = String(containerId || '').trim();
  if (!id || !runContext || typeof runContext !== 'object') return;

  const existing = await resolveOpenaiContainerId(env, runContext);
  if (existing) return;

  const bag = pinBag(runContext);
  if (bag) bag.container_id = id;
  else runContext.openai_container_id = id;

  const scope = openaiContainerScopeKey(runContext);
  if (!scope || !env?.DB) return;

  const workspaceId = String(runContext.workspaceId || runContext.workspace_id || '').trim() || null;
  const userId = String(runContext.userId || runContext.user_id || '').trim() || null;
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO agentsam_openai_container_pin
         (agent_run_id, container_id, workspace_id, user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`,
    )
      .bind(scope, id, workspaceId, userId)
      .run();
  } catch (e) {
    console.warn('[openai-container-pin] persist_failed', e?.message || e);
  }
}

/**
 * Extract container_id from hosted-shell SSE events / Responses items.
 * @param {Array<Record<string, unknown>>|null|undefined} events
 */
export function extractContainerIdFromHostedShellEvents(events) {
  if (!Array.isArray(events)) return null;
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    const direct = String(e.container_id || e.containerId || '').trim();
    if (direct) return direct;
    const action = e.action && typeof e.action === 'object' ? e.action : null;
    if (action) {
      const a = String(action.container_id || action.containerId || '').trim();
      if (a) return a;
    }
  }
  return null;
}
