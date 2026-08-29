const POOL_WAIT_RE = /timed out while waiting for an open slot|failed to acquire a connection from the pool|max clients reached|emaxconnsession/i;

async function withPoolRetry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (!POOL_WAIT_RE.test(String(error?.message || error)) || i === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 175 * 2 ** i + Math.floor(Math.random() * 80)));
    }
  }
  throw last;
}

export function isHyperdriveUsable(env) {
  return Boolean(
    env?.HYPERDRIVE &&
      (typeof env.HYPERDRIVE.query === 'function' ||
        (typeof env.HYPERDRIVE.connectionString === 'string' && env.HYPERDRIVE.connectionString.trim())),
  );
}

export async function runHyperdriveQuery(env, sql, params = []) {
  if (!env?.HYPERDRIVE) return { ok: false, rows: [], error: 'hyperdrive_binding_absent' };
  if (typeof env.HYPERDRIVE.query === 'function') {
    try {
      const result = await withPoolRetry(() => env.HYPERDRIVE.query(sql, params));
      return { ok: true, rows: result?.rows || [] };
    } catch (error) {
      return { ok: false, rows: [], error: String(error?.message || error) };
    }
  }
  const connectionString = String(env.HYPERDRIVE.connectionString || '').trim();
  if (!connectionString) return { ok: false, rows: [], error: 'hyperdrive_connection_string_missing' };
  let client;
  try {
    const { Client } = await import('pg');
    client = await withPoolRetry(async () => {
      const candidate = new Client({ connectionString });
      await candidate.connect();
      return candidate;
    });
    const result = await client.query(sql, params);
    return { ok: true, rows: result?.rows || [] };
  } catch (error) {
    return { ok: false, rows: [], error: String(error?.message || error) };
  } finally {
    if (client) await client.end().catch(() => {});
  }
}
