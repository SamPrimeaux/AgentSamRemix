/**
 * Storage-semantics contract for the memory service.
 *
 * Postgres implements this. Vectorize may later implement search() as a
 * rebuildable projection, but must not become the write SSOT.
 */
export const MEMORY_STORE_METHODS = Object.freeze([
  'insert',
  'getById',
  'search',
  'list',
  'update',
  'softDelete',
]);

/**
 * @param {import('./memory-types.js').MemoryStore} store
 */
export function assertMemoryStore(store) {
  if (!store || typeof store !== 'object') {
    throw new TypeError('memory store is required');
  }
  for (const method of MEMORY_STORE_METHODS) {
    if (typeof store[method] !== 'function') {
      throw new TypeError(`memoryStore.${method}() is required`);
    }
  }
  return store;
}
