import { formatSessionCookieHeader } from '../auth/session-cookies.js';
import { peekSessionUpgradeToken } from '../identity/index.js';

const finalizedResponses = new WeakSet();
const LEGACY_COOKIE_CLEAR_DOMAINS = ['.inneranimalmedia.com', '.sandbox.inneranimalmedia.com'];

function responseSetCookies(headers) {
  if (typeof headers?.getAll === 'function') return headers.getAll('set-cookie');
  if (typeof headers?.getSetCookie === 'function') return headers.getSetCookie();
  const single = headers?.get?.('set-cookie');
  return single ? [single] : [];
}

export function finalizeWorkerResponse(route, response) {
  if (!response || route?.authMode === 'none' || finalizedResponses.has(response)) return response;

  const request = route.request;
  const cookieHeader = request?.headers?.get?.('Cookie') || '';
  const sessionCount = (cookieHeader.match(/(?:^|;\s*)session=/g) || []).length;
  const headers = new Headers(response.headers);
  const setCookies = responseSetCookies(headers);
  const isSettingSession = setCookies.some(
    (value) => value.startsWith('session=') && !value.includes('Expires=Thu, 01 Jan 1970'),
  );

  if (!isSettingSession && sessionCount > 1) {
    for (const domain of LEGACY_COOKIE_CLEAR_DOMAINS) {
      const alreadyCleared = setCookies.some(
        (value) => value.startsWith('session=') && value.includes(`Domain=${domain}`) && value.includes('Expires=Thu, 01 Jan 1970'),
      );
      if (!alreadyCleared) {
        headers.append(
          'Set-Cookie',
          `session=; Domain=${domain}; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`,
        );
      }
    }
  }

  const upgradeToken = peekSessionUpgradeToken(request);
  if (!isSettingSession && upgradeToken) {
    headers.append('Set-Cookie', formatSessionCookieHeader(upgradeToken));
  }

  const finalized = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  finalizedResponses.add(finalized);
  return finalized;
}

export function workerNotFoundResponse(route) {
  if (route.pathLower.startsWith('/api/')) {
    return Response.json({ error: 'Not found', path: route.url.pathname }, { status: 404 });
  }
  return new Response('Not Found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
