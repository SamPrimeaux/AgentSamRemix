/**
 * Frontend/API contract for Agent Sam memory.
 *
 * Callers know only this surface. They must not import Gemini, pgvector,
 * Supabase, HNSW, or Vectorize from app/dashboard/ or packages/client.
 *
 *   memory.search({ query, workspaceId, limit: 12 })
 *   memory.remember({ content, workspaceId, subjectId, sourceType })
 */
export const MEMORY_CLIENT_METHODS = Object.freeze([
  'remember',
  'search',
  'forget',
  'update',
  'get',
  'list',
  'consolidate',
]);

/**
 * @param {unknown} client
 */
export function assertMemoryClient(client) {
  if (!client || typeof client !== 'object') {
    throw new TypeError('memory client is required');
  }
  for (const method of MEMORY_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(`memory.${method}() is required`);
    }
  }
  return client;
}
