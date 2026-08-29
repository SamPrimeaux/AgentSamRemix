export async function routeHandleAgentMemorySync() {
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
}
export async function routeInsertCuratedAgentMemory() { return { id: crypto.randomUUID(), embedding_dims: null }; }
export async function routeSearchCuratedAgentMemory() { return { results: [], embed_model: null }; }
export async function routeSearchPrivateAgentsamMemory() { return { ok: true, tier: 'd1', results: [] }; }
export async function routeMemoryWrite() { return { ok: false, error: 'memory_write_unavailable' }; }
export async function routeRunAgentsamMemoryMaintenance() { return { ok: true, scanned: 0 }; }
export async function routeResolveAgentsamMemory() { return { ok: true, resolved: 0 }; }
export async function routeBackfillPrivateMemoryFromD1() { return { ok: true, scanned: 0 }; }
export function routeIsHyperdriveUsable(env) { return Boolean(env?.HYPERDRIVE); }
export async function routeRunAgentsamMemoryVectorSync() { return { ok: true, embedded: 0 }; }
