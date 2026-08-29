/**
 * Cloudflare Hyperdrive: production binding is `env.HYPERDRIVE`.
 * Some runtimes expose `.query(sql, params)`; the documented shape uses
 * `.connectionString` with a Postgres driver (see `src/api/rag.js` `withPg`).
 * Analytics incorrectly required `.query` only, which hides a configured binding.
 */

const POOL_WAIT_RE =
  /timed out while waiting for an open slot|failed to acquire a connection from the pool|max clients reached|emaxconnsession/i;

/** @param {unknown} err */
export function isHyperdrivePoolWaitError(err) {
  const msg = err?.message != null ? String(err.message) : String(err ?? '');
  return POOL_WAIT_RE.test(msg);
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ attempts?: number, baseMs?: number }} [opts]
 */
async function withHyperdrivePoolRetry(fn, opts = {}) {
  const attempts = Math.max(1, Math.min(6, Number(opts.attempts) || 4));
  const baseMs = Math.max(50, Number(opts.baseMs) || 175);
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isHyperdrivePoolWaitError(e) || i === attempts - 1) throw e;
      const delay = baseMs * 2 ** i + Math.floor(Math.random() * 80);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/** @param {any} env */
export function isHyperdriveBindingPresent(env) {
  return env != null && env.HYPERDRIVE != null && typeof env.HYPERDRIVE === 'object';
}

/** @param {any} env */
export function hyperdriveNativeQueryAvailable(env) {
  return typeof env?.HYPERDRIVE?.query === 'function';
}

/** @param {any} env */
export function hyperdriveConnectionStringAvailable(env) {
  const cs = env?.HYPERDRIVE?.connectionString;
  return typeof cs === 'string' && cs.trim().length > 0;
}

/**
 * Binding is present and we can run SQL (native .query or pg + connectionString).
 * @param {any} env
 */
export function isHyperdriveUsable(env) {
  if (!isHyperdriveBindingPresent(env)) return false;
  return hyperdriveNativeQueryAvailable(env) || hyperdriveConnectionStringAvailable(env);
}

/**
 * @param {any} env
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<{ ok: boolean, rows: any[], error?: string, meta?: Record<string, unknown> }>}
 */
export async function runHyperdriveQuery(env, sql, params = []) {
  if (!isHyperdriveBindingPresent(env)) {
    return { ok: false, rows: [], error: 'hyperdrive_binding_absent' };
  }
  if (hyperdriveNativeQueryAvailable(env)) {
    try {
      const result = await withHyperdrivePoolRetry(() => env.HYPERDRIVE.query(sql, params));
      return { ok: true, rows: result?.rows ?? [], meta: result?.meta ?? {} };
    } catch (e) {
      return { ok: false, rows: [], error: e?.message ? String(e.message) : String(e) };
    }
  }
  if (hyperdriveConnectionStringAvailable(env)) {
    try {
      const result = await withHyperdrivePoolRetry(async () => {
        const { Client } = await import('pg');
        const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
        await client.connect();
        try {
          return await client.query(sql, params);
        } finally {
          await client.end().catch(() => {});
        }
      });
      return { ok: true, rows: result?.rows ?? [], meta: {} };
    } catch (e) {
      return { ok: false, rows: [], error: e?.message ? String(e.message) : String(e) };
    }
  }
  return { ok: false, rows: [], error: 'hyperdrive_no_query_path' };
}

/**
 * Hold one Hyperdrive/pg client for many queries (autocommit). Prefer this for
 * multi-thousand symbol/chunk write batches — avoids connect/query/end per row
 * which exhausts Supabase session-mode pool_size (EMAXCONNSESSION).
 *
 * @param {any} env
 * @param {(client: { query: (sql: string, params?: unknown[]) => Promise<any> }) => Promise<any>} callback
 */
export async function runHyperdriveSession(env, callback) {
  if (!isHyperdriveBindingPresent(env)) {
    return { ok: false, rows: [], error: 'hyperdrive_binding_absent' };
  }

  if (hyperdriveConnectionStringAvailable(env)) {
    let client;
    try {
      // Retry only connect — never re-run the callback (upserts/deletes) on pool wait.
      client = await withHyperdrivePoolRetry(async () => {
        const { Client } = await import('pg');
        const c = new Client({ connectionString: env.HYPERDRIVE.connectionString });
        await c.connect();
        return c;
      });
      const result = await callback(client);
      return {
        ok: true,
        rows: Array.isArray(result?.rows) ? result.rows : [],
        result,
        meta: { path: 'pg_session' },
      };
    } catch (e) {
      return { ok: false, rows: [], error: e?.message ? String(e.message) : String(e) };
    } finally {
      if (client) await client.end().catch(() => {});
    }
  }

  if (hyperdriveNativeQueryAvailable(env)) {
    try {
      const adapter = {
        query: async (sql, params = []) =>
          withHyperdrivePoolRetry(() => env.HYPERDRIVE.query(sql, params)),
      };
      const result = await callback(adapter);
      return {
        ok: true,
        rows: Array.isArray(result?.rows) ? result.rows : [],
        result,
        meta: { path: 'native_session' },
      };
    } catch (e) {
      return { ok: false, rows: [], error: e?.message ? String(e.message) : String(e) };
    }
  }

  return { ok: false, rows: [], error: 'hyperdrive_no_query_path' };
}

/**
 * Run multiple Hyperdrive/Postgres queries in one connection + transaction.
 * Pass a callback that receives a { query(sql, params) } client.
 * Returns { ok, rows, result, error, meta } — same shape as runHyperdriveQuery.
 *
 * Prefer {@link runHyperdriveSession} for long embed batches (autocommit, no
 * giant open transaction). Use this when atomic multi-statement commit matters.
 *
 * @param {any} env
 * @param {(client: { query: (sql: string, params?: unknown[]) => Promise<any> }) => Promise<any>} callback
 */
export async function runHyperdriveTransaction(env, callback) {
  if (!isHyperdriveBindingPresent(env)) {
    return { ok: false, rows: [], error: 'hyperdrive_binding_absent' };
  }

  if (hyperdriveConnectionStringAvailable(env)) {
    let client;
    try {
      const { Client } = await import('pg');
      client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
      await client.connect();
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return {
        ok: true,
        rows: Array.isArray(result?.rows) ? result.rows : [],
        result,
        meta: { path: 'pg_transaction' },
      };
    } catch (e) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      return { ok: false, rows: [], error: e?.message ? String(e.message) : String(e) };
    } finally {
      if (client) await client.end().catch(() => {});
    }
  }

  if (hyperdriveNativeQueryAvailable(env)) {
    try {
      await env.HYPERDRIVE.query('BEGIN', []);
      const adapter = {
        query: async (sql, params = []) => env.HYPERDRIVE.query(sql, params),
      };
      const result = await callback(adapter);
      await env.HYPERDRIVE.query('COMMIT', []);
      return {
        ok: true,
        rows: Array.isArray(result?.rows) ? result.rows : [],
        result,
        meta: { path: 'native_transaction', ...(result?.meta ?? {}) },
      };
    } catch (e) {
      await env.HYPERDRIVE.query('ROLLBACK', []).catch(() => {});
      return { ok: false, rows: [], error: e?.message ? String(e.message) : String(e) };
    }
  }

  return { ok: false, rows: [], error: 'hyperdrive_no_query_path' };
}
