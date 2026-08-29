/**
 * Standard JSON response helper for backend HTTP surfaces.
 * Keep wire compatibility with the legacy Worker response helper while src/ retires.
 */
export function httpJsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Terminal-Secret',
      ...extraHeaders,
    },
  });
}
