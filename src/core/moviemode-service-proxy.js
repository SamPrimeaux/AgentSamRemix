/**
 * Proxy globe landing + optional studio static to moviemode-service worker.
 * Main site: inneranimalmedia.com/globe → service root (Code = Communication scene).
 */
import { buildBridgeAuthHeaders } from '../../backend/auth/bridge-key-auth.js';

/**
 * @param {string} pathname
 */
export function shouldProxyToMoviemodeService(pathname) {
  const p = String(pathname || '').replace(/\/$/, '') || '/';
  return p === '/globe' || p.startsWith('/globe/');
}

/**
 * @param {Request} request
 * @param {any} env
 * @returns {Promise<Response | null>}
 */
export async function proxyToMoviemodeService(request, env) {
  const binding = env?.MOVIEMODE_SERVICE;
  if (!binding?.fetch) return null;

  const url = new URL(request.url);
  let targetPath = url.pathname;

  if (targetPath === '/globe' || targetPath === '/globe/') {
    targetPath = '/';
  } else if (targetPath.startsWith('/globe/')) {
    targetPath = targetPath.slice('/globe'.length) || '/';
  }

  url.pathname = targetPath;

  const headers = new Headers(request.headers);
  const bridgeHeaders = buildBridgeAuthHeaders(env);
  for (const [k, v] of Object.entries(bridgeHeaders)) {
    if (!headers.has(k)) headers.set(k, v);
  }

  const init = {
    method: request.method,
    headers,
    redirect: request.redirect,
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
  }

  return binding.fetch(new Request(url.toString(), init));
}
