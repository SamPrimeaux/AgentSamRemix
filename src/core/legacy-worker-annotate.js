/**
 * Observability for responses still served via worker.js (legacy monolith).
 * Does not change routing — only headers + structured console warning.
 */
export function annotateLegacyWorkerResponse(response, request, tag) {
  if (!response || typeof response.status !== 'number') return response;
  try {
    const url = new URL(request.url);
    console.warn('[legacyWorker:fallback]', tag || 'legacy', request.method, url.pathname);
    const headers = new Headers(response.headers);
    headers.set('X-IAM-Route-Source', 'legacy-worker');
    headers.set('X-IAM-Legacy-Fallback', '1');
    if (tag) headers.set('X-IAM-Legacy-Reason', String(tag));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (e) {
    console.warn('[legacyWorker:fallback] annotate failed', e?.message ?? e);
    return response;
  }
}
