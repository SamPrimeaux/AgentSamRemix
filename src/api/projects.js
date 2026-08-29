/**
 * Projects API — /api/projects* (D1 canonical; Supabase mirror on every write).
 * Implementation peeled to src/api/projects/*.js — keep this shim for finance.js.
 */
export { handleProjectsApi } from './projects/index.js';
