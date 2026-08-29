/**
 * Public GET /api/health/hyperdrive — no secrets, no connection strings.
 */
import { jsonResponse } from '../../core/responses.js';
import {
  isHyperdriveBindingPresent,
  isHyperdriveUsable,
  hyperdriveNativeQueryAvailable,
  hyperdriveConnectionStringAvailable,
  runHyperdriveQuery,
} from '../../../backend/services/database/hyperdrive.js';

const BINDING_NAME = 'HYPERDRIVE';

/**
 * @param {any} env
 * @param {URL} url
 */
export async function handlePublicHyperdriveHealth(env, url) {
  const checkedAt = new Date().toISOString();
  const hasHyperdrive = isHyperdriveBindingPresent(env);
  const hasQueryable = hyperdriveNativeQueryAvailable(env);
  const hasConnectionString = hyperdriveConnectionStringAvailable(env);

  console.log('[hyperdrive.health]', {
    hasHyperdrive,
    hasQueryable,
    hasConnectionString,
    route: url.pathname,
    runtime: 'cloudflare-worker',
  });

  if (!hasHyperdrive) {
    return jsonResponse({
      ok: true,
      has_hyperdrive_binding: false,
      binding_name: BINDING_NAME,
      checked_at: checkedAt,
      connection_test: { ok: false, error: 'binding_absent' },
    });
  }

  if (!isHyperdriveUsable(env)) {
    return jsonResponse({
      ok: true,
      has_hyperdrive_binding: true,
      binding_name: BINDING_NAME,
      checked_at: checkedAt,
      connection_test: { ok: false, error: 'no_query_interface_or_connection_string' },
    });
  }

  const r = await runHyperdriveQuery(env, 'SELECT 1 AS ok', []);
  return jsonResponse({
    ok: true,
    has_hyperdrive_binding: true,
    binding_name: BINDING_NAME,
    checked_at: checkedAt,
    connection_test: {
      ok: r.ok,
      error: r.ok ? null : (r.error || 'query_failed'),
    },
  });
}
