/**
 * Platform D1/Hyperdrive IDs — must match backend/config/worker-bindings.js (PRODUCTION_WORKER_BINDINGS).
 * Full catalog lives in backend/config; src/core stays platform-rank (no backend import).
 */
export const DB = Object.freeze({
  binding: 'DB',
  database_id: 'cf87b717-d4e2-4cf8-bab0-a81268e32d49',
  database_name: 'inneranimalmedia-business',
});

export const HYPERDRIVE = Object.freeze({
  binding: 'HYPERDRIVE',
  id: '08183bb9d2914e87ac8395d7e4ecff60',
});
