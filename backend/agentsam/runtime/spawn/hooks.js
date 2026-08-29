// guard-dup-allow: backend spawn peel; shared hook callers migrate separately.
/**
 * Narrow hook dispatcher for asynchronous spawn events.
 *
 * Spawn warnings already deliver directly through web-push. This seam retains
 * registered webhook/log hooks without importing the legacy hook stack.
 */

export async function fireAgentHooks(env, _ctx, eventType, payload = {}) {
  if (!env?.DB || !eventType) return;
  const rows = await env.DB.prepare(
    `SELECT hook_key, handler_type, handler_config, command
       FROM agentsam_hook
      WHERE COALESCE(is_active, 1) = 1
        AND (COALESCE(event_type, trigger) = ? OR event_type = '*')`,
  ).bind(String(eventType)).all().catch(() => ({ results: [] }));
  for (const hook of rows.results || []) {
    let config = {};
    try {
      config = typeof hook.handler_config === 'string'
        ? JSON.parse(hook.handler_config || '{}')
        : hook.handler_config || {};
    } catch {
      config = {};
    }
    const url = String(config.url || '').trim();
    if (hook.handler_type === 'webhook' && url) {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: eventType, ...payload }),
      }).catch((error) => {
        console.warn('[spawn-hooks] webhook failed', hook.hook_key, error?.message ?? error);
      });
    } else if (hook.handler_type === 'log_only') {
      console.log('[spawn-hook]', hook.hook_key || eventType, JSON.stringify(payload).slice(0, 4000));
    }
  }
}
