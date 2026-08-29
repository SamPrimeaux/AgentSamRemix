/**
 * Link preload headers for Cloudflare Early Hints on dashboard SPA shell responses.
 */

const DASHBOARD_PRELOAD_LINKS = [
  '</static/dashboard/shell.css>; rel=preload; as=style',
  '</static/dashboard/app/dashboard.css>; rel=preload; as=style',
  '</static/dashboard/app/dashboard.js>; rel=modulepreload; crossorigin',
  '</static/dashboard/app/vendor-react.js>; rel=modulepreload; crossorigin',
  '</static/dashboard/app/vendor-icons.js>; rel=modulepreload; crossorigin',
];

/**
 * @param {Response} response
 * @returns {Response}
 */
export function withDashboardEarlyHints(response) {
  const headers = new Headers(response.headers);
  for (const link of DASHBOARD_PRELOAD_LINKS) {
    headers.append('Link', link);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * @param {string} pathLower
 * @returns {boolean}
 */
export function isDashboardSpaShellPath(pathLower) {
  return (
    pathLower.startsWith('/dashboard/') ||
    pathLower === '/onboarding' ||
    pathLower.startsWith('/onboarding/')
  );
}
