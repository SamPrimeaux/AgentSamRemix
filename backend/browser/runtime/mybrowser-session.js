/**
 * MYBROWSER-first Browser Run session bootstrap.
 * acquire(binding) → session_id, then Browser Run REST for Live View URLs.
 */
import {
  createBrowserRunSession,
  extractBrowserRunTargetFields,
  listBrowserRunTargets,
  pickBrowserRunPageTarget,
  refreshBrowserRunLiveView,
} from '../cloudflare/browser-run.js';

const DEFAULT_KEEP_ALIVE_MS = 600_000;

/**
 * @param {any} env
 * @param {{ keepAliveMs?: number }} [opts]
 */
export async function bootstrapBrowserLeaseSession(env, opts = {}) {
  const keepAliveMs = Math.min(
    600_000,
    Math.max(60_000, Number(opts.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS) || DEFAULT_KEEP_ALIVE_MS),
  );

  if (!env.MYBROWSER) {
    return { ok: false, error: 'MYBROWSER binding not configured' };
  }

  const pw = await import('@cloudflare/playwright');
  if (typeof pw.acquire === 'function') {
    try {
      const acquired = await pw.acquire(env.MYBROWSER, { keep_alive: keepAliveMs });
      const sessionId = String(acquired?.sessionId || acquired?.session_id || '').trim();
      if (sessionId) {
        const listed = await listBrowserRunTargets(env, sessionId);
        const target = pickBrowserRunPageTarget(listed.ok ? listed.targets : []);
        const fields = target ? extractBrowserRunTargetFields(target) : {};
        const refreshed = await refreshBrowserRunLiveView(env, {
          sessionId,
          targetId: fields.targetId,
        });
        if (refreshed.ok) {
          return {
            ok: true,
            sessionId,
            keepAliveMs,
            targetId: refreshed.targetId ?? fields.targetId ?? null,
            url: refreshed.url ?? fields.url ?? null,
            title: refreshed.title ?? fields.title ?? null,
            devtoolsFrontendUrl: refreshed.devtoolsFrontendUrl ?? fields.devtoolsFrontendUrl ?? null,
            webSocketDebuggerUrl: refreshed.webSocketDebuggerUrl ?? fields.webSocketDebuggerUrl ?? null,
            targets: listed.ok ? listed.targets : [],
            bootstrap: 'mybrowser_acquire',
          };
        }
        return {
          ok: true,
          sessionId,
          keepAliveMs,
          ...fields,
          targets: listed.ok ? listed.targets : [],
          bootstrap: 'mybrowser_acquire',
        };
      }
    } catch (e) {
      console.warn('[browser/mybrowser-session] acquire failed', String(e?.message || e));
    }
  }

  const created = await createBrowserRunSession(env, { keepAliveMs, targets: true });
  if (!created.ok) return created;
  return { ...created, bootstrap: 'browser_run_rest' };
}
