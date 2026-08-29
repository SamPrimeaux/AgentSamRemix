export async function routePingPtyServiceHealth(env) {
  return { status: env?.PTY_SERVICE ? 'connected' : 'disconnected' };
}
export async function routeIsEtoThompsonOwner(env) { return Boolean(env?.DB); }
export async function routeApplyEtoToRoutingArms() { return { applied: 0, pending: 0 }; }
export async function routeDispatchSemanticRetrieval(_env, { lane = 'docs' } = {}) {
  return { ok: true, lane, results: [] };
}
export async function routeResolveWorkersAiImageModelFromCatalog() { return null; }
export async function routeExtractWorkersAiImageBytes(result, { fallbackContentType = 'image/jpeg' } = {}) {
  if (result instanceof ArrayBuffer || result instanceof Uint8Array) {
    return { bytes: result, contentType: fallbackContentType };
  }
  throw new Error('Workers AI returned no image bytes');
}
