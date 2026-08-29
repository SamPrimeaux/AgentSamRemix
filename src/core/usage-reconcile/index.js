/**
 * index.js
 * Single entry point for cron. Orchestration only -- no business logic
 * belongs in this file. If you're about to add a switch/if on provider name
 * beyond what ADAPTERS already gives you, that logic belongs in
 * provider-reconcile.js instead.
 * Wire into backend/jobs/midnight-utc.js via cronLedgerWrap, same pattern
 * as every other job in that file.
 */
import { ADAPTERS, reconcileProviderDay } from './provider-reconcile.js';
import { checkAgentIntegrityDay } from './agent-integrity.js';

/**
 * @param {any} env
 * @param {string} day - 'YYYY-MM-DD', prior UTC day
 * @returns {Promise<{ rowsWritten: number, metadata: object }>}
 */
export async function runDailyUsageReconciliation(env, day) {
  const providers = Object.keys(ADAPTERS);
  const layer1 = [];
  for (const provider of providers) {
    layer1.push(
      await reconcileProviderDay(env, provider, day).catch((e) => ({
        provider, day, status: 'crashed', error: e.message,
      })),
    );
  }

  const layer2 = [];
  for (const provider of providers) {
    layer2.push(
      await checkAgentIntegrityDay(env, provider, day).catch((e) => ({
        provider, day, status: 'crashed', error: e.message,
      })),
    );
  }

  // TODO(swarm): if any layer1 result has status='drift', add a note to
  // tkt_2b26bcee109f469b (or open a new ticket) via agentsam_ticket_add_note
  // instead of only writing the D1 row -- otherwise this is silent again.

  return {
    rowsWritten: layer1.reduce((n, o) => n + (o.results?.length ?? 0), 0),
    metadata: { day, providers, layer1, layer2 },
  };
}
