export async function routeHandleCatalogInvokeApi(request) {
  if (request.method.toUpperCase() !== 'POST') return new Response(
    JSON.stringify({ error: 'Method not allowed' }),
    { status: 405, headers: { 'content-type': 'application/json' } },
  );
  return new Response(JSON.stringify({ ok: false, error: 'catalog_dispatch_unavailable' }), {
    status: 503, headers: { 'content-type': 'application/json' },
  });
}
export async function routeExecuteFindToolsMetaTool() { return { ok: true, result: { tools: [], top_scores: [] } }; }
export function routeNormalizeAgentRuntimeMode(raw) {
  return ['ask', 'plan', 'agent', 'debug', 'multitask'].includes(String(raw)) ? String(raw) : 'agent';
}
export function routeListAgentModesForApi() { return []; }
export async function routeExecuteCommand() { return { ok: false, error: 'command_dispatch_unavailable', status: 503 }; }
