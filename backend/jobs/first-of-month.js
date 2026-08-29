/**
 * 0 0 1 * * — first-of-month maintenance (email retention rollups + spend_ledger rollup).
 */
import { runEmailMonthlyRollup } from './email-monthly-rollup.js';
import { runSpendLedgerRollup } from './spend-ledger-rollup.js';

/**
 * @param {any} env
 */
export async function runFirstOfMonthJobs(env) {
  await runEmailMonthlyRollup(env);
  await runSpendLedgerRollup(env);
}
