/**
 * adapters/base.js
 * Contract every provider adapter implements. Core (provider-reconcile.js)
 * never imports a provider SDK directly -- only calls fetchProviderUsage.
 * DO NOT add logic here. If shared logic is needed across adapters, it goes
 * in provider-reconcile.js, not here.
 */

/**
 * @typedef {Object} ProviderDayUsage
 * @property {string} model
 * @property {number} tokens_in
 * @property {number} tokens_out
 * @property {number} cost_usd
 */

/**
 * @param {any} env
 * @param {{ day: string }} params - day = 'YYYY-MM-DD', UTC
 * @returns {Promise<ProviderDayUsage[]>}
 */
export async function fetchProviderUsage(env, { day }) {
  throw new Error('not implemented -- use a concrete adapter, not base.js directly');
}
