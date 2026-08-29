/**
 * Code-index write pipe (LOCKED).
 *
 * Bulk upserts (files/chunks/symbols):
 *   1) Prefer env.HYPERDRIVE.connectionString (CF edge → origin session pooler)
 *   2) Fallback SUPABASE_DB_URL session pooler :5432 (scripts / no binding)
 * Never paste Hyperdrive URLs into SUPABASE_DB_URL.
 * Never transaction pooler :6543. Direct db.*.supabase.co is IPv6-only (smoke only).
 * agentsam_codebase_retrieve → Hyperdrive (same binding OK for ANN).
 * D1 jobs/nodes/edges → env.DB on Worker is fine.
 *
 * Connection law (nano-tier Supabase bhnroxezfejseflxwspb):
 * - Prefer ONE live client reused across writers in a batch (createCodeIndexPgBatchSession).
 * - Do not hold a socket idle across long embed/GitHub work without ensureClient() —
 *   Supavisor / Hyperdrive drops idle sessions as "Connection terminated unexpectedly".
 * - Retries apply to connect / ensure only — never re-run a whole parse callback.
 * - Transient PG must not terminal-fail the queue job (handler requeues).
 */

const POOL_WAIT_RE =
  /timed out while waiting for an open slot|failed to acquire a connection from the pool|max clients reached|emaxconnsession/i;

const TRANSIENT_PG_RE =
  /connection terminated|econnreset|epipe|not queryable|connection refused|socket hang up|server closed the connection|client has already been disconnected|eaddrnotavail|enotfound|getaddrinfo|57p01|08006|08003|08001/i;

const TRANSIENT_PG_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'EADDRNOTAVAIL',
  'ENOTFOUND',
  '57P01',
  '08006',
  '08003',
  '08001',
]);

/** Connect-only retries (not callback re-entry). */
const CONNECT_RETRY_ATTEMPTS = 3;
const CONNECT_BACKOFF_MS = Object.freeze([800, 1600, 3200]);

/** Re-ping / reconnect if the shared client sat idle this long (Supavisor idle kill). */
const BATCH_IDLE_RECONNECT_MS = 12_000;

/** @param {unknown} err */
export function isCodeIndexPgPoolWaitError(err) {
  const msg = err?.message != null ? String(err.message) : String(err ?? '');
  return POOL_WAIT_RE.test(msg);
}

/**
 * @param {unknown} err
 */
export function isCodeIndexPgTransientError(err) {
  if (isCodeIndexPgPoolWaitError(err)) return false;
  const msg = err?.message != null ? String(err.message) : String(err ?? '');
  const code = err?.code != null ? String(err.code) : '';
  return TRANSIENT_PG_RE.test(msg) || TRANSIENT_PG_CODES.has(code);
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

/**
 * @param {any} env
 * @returns {string}
 */
export function resolveCodeIndexSessionPoolerUrl(env) {
  const fromEnvObj = env != null && env.SUPABASE_DB_URL != null ? String(env.SUPABASE_DB_URL).trim() : '';
  const url =
    fromEnvObj ||
    (env == null ? String(process.env?.SUPABASE_DB_URL || '').trim() : '');
  if (!url) {
    const e = new Error('code_index_supabase_db_url_required');
    e.code = 'code_index_supabase_db_url_required';
    throw e;
  }
  if (/:(6543)(?:\/|\?|$)/.test(url)) {
    const e = new Error('code_index_transaction_pooler_forbidden:use_session_pooler_5432');
    e.code = 'code_index_transaction_pooler_forbidden';
    throw e;
  }
  if (/hyperdrive\.local/i.test(url) || /hyperdrive\.cloudflare/i.test(url)) {
    const e = new Error('code_index_hyperdrive_url_forbidden');
    e.code = 'code_index_hyperdrive_url_forbidden';
    throw e;
  }
  return url;
}

/**
 * Direct db.<ref>.supabase.co URL for smoke comparison only (often IPv6-unreachable from Workers).
 * Prefers SUPABASE_DB_DIRECT_URL; else derives host from SUPABASE_PROJECT_REF + password from session URL.
 * @param {any} env
 * @returns {string}
 */
export function resolveCodeIndexDirectDbUrl(env) {
  const explicit =
    env != null && env.SUPABASE_DB_DIRECT_URL != null
      ? String(env.SUPABASE_DB_DIRECT_URL).trim()
      : env == null
        ? String(process.env?.SUPABASE_DB_DIRECT_URL || '').trim()
        : '';
  if (explicit) {
    if (/:(6543)(?:\/|\?|$)/.test(explicit)) {
      const e = new Error('code_index_direct_url_must_not_be_transaction_pooler');
      e.code = 'code_index_direct_url_invalid';
      throw e;
    }
    return explicit;
  }

  const ref = String(
    env?.SUPABASE_PROJECT_REF ||
      (env == null ? process.env?.SUPABASE_PROJECT_REF : '') ||
      '',
  )
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9]{10,}$/.test(ref)) {
    const e = new Error('code_index_direct_url_project_ref_required');
    e.code = 'code_index_direct_url_project_ref_required';
    throw e;
  }

  let sessionUrl;
  try {
    sessionUrl = resolveCodeIndexSessionPoolerUrl(env);
  } catch (e) {
    const err = new Error('code_index_direct_url_needs_session_url_for_password');
    err.code = 'code_index_direct_url_needs_session_url_for_password';
    err.cause = e;
    throw err;
  }
  const u = new URL(sessionUrl);
  const user = u.username || `postgres.${ref}`;
  const pass = u.password || '';
  if (!pass) {
    const e = new Error('code_index_direct_url_password_missing');
    e.code = 'code_index_direct_url_password_missing';
    throw e;
  }
  const db = u.pathname.replace(/^\//, '') || 'postgres';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@db.${ref}.supabase.co:5432/${db}`;
}

/**
 * Hyperdrive binding connection string (Worker-only).
 * @param {any} env
 * @returns {string}
 */
export function resolveCodeIndexHyperdriveUrl(env) {
  const cs = env?.HYPERDRIVE?.connectionString;
  if (cs == null || !String(cs).trim()) {
    const e = new Error('code_index_hyperdrive_binding_required');
    e.code = 'code_index_hyperdrive_binding_required';
    throw e;
  }
  return String(cs).trim();
}

/**
 * Production write URL: Hyperdrive when bound, else session pooler secret.
 * @param {any} env
 * @returns {{ connectionString: string, write_pipe: 'hyperdrive'|'supabase_session_pooler' }}
 */
export function resolveCodeIndexWriteConnection(env) {
  if (env?.HYPERDRIVE?.connectionString) {
    return {
      connectionString: resolveCodeIndexHyperdriveUrl(env),
      write_pipe: 'hyperdrive',
    };
  }
  return {
    connectionString: resolveCodeIndexSessionPoolerUrl(env),
    write_pipe: 'supabase_session_pooler',
  };
}

/**
 * @param {any} env
 */
export function isCodeIndexWorkerIsolate(env) {
  return env != null && env.HYPERDRIVE != null && typeof env.HYPERDRIVE === 'object';
}

/**
 * @param {any} env
 */
export function assertCodeIndexBulkWriteHost(env) {
  resolveCodeIndexWriteConnection(env);
}

/**
 * @param {any} env
 */
export function isCodeIndexWritePipeUsable(env) {
  try {
    resolveCodeIndexWriteConnection(env);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} connectionString
 * @returns {Promise<import('pg').Client>}
 */
async function connectCodeIndexPgClientWithUrl(connectionString) {
  const { Client } = await import('pg');
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 8_000,
    ssl: /localhost|127\.0\.0\.1|hyperdrive\.local/i.test(connectionString)
      ? undefined
      : { rejectUnauthorized: false },
  });
  client.on('error', (err) => {
    console.warn(
      '[code-index-write-pipe] idle_client_error',
      String(err?.message || err).slice(0, 180),
    );
  });
  await client.connect();
  return client;
}

/**
 * @param {any} env
 * @returns {Promise<import('pg').Client>}
 */
async function connectCodeIndexPgClientOnce(env) {
  const { connectionString } = resolveCodeIndexWriteConnection(env);
  return connectCodeIndexPgClientWithUrl(connectionString);
}

/**
 * Connect with backoff — retries handshake only, never application work.
 * @param {any} env
 * @returns {Promise<import('pg').Client>}
 */
export async function connectCodeIndexPgClientWithRetry(env) {
  assertCodeIndexBulkWriteHost(env);
  let lastErr;
  for (let attempt = 1; attempt <= CONNECT_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await connectCodeIndexPgClientOnce(env);
    } catch (e) {
      lastErr = e;
      if (isCodeIndexPgPoolWaitError(e)) {
        const err = new Error(`code_index_pg_pool_wait_hard_fail:${e?.message || e}`);
        err.code = 'code_index_pg_pool_wait_hard_fail';
        throw err;
      }
      if (!isCodeIndexPgTransientError(e) || attempt >= CONNECT_RETRY_ATTEMPTS) {
        throw e instanceof Error ? e : new Error(String(e));
      }
      console.warn('[code-index-write-pipe] batch_connect_retry', {
        attempt,
        error: String(e?.message || e).slice(0, 180),
      });
      await sleepMs(CONNECT_BACKOFF_MS[attempt - 1] ?? 800 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || 'code_index_pg_connect_failed'));
}

/**
 * @param {unknown} client
 * @returns {boolean}
 */
function isLivePgClient(client) {
  return (
    client != null &&
    typeof client === 'object' &&
    typeof client.query === 'function' &&
    client._ending !== true &&
    client._ended !== true
  );
}

/**
 * Sanitize connection string for ops receipts — host/port/db only, never user/password.
 * @param {string} connectionString
 */
export function summarizeCodeIndexSessionPoolerUrl(connectionString) {
  const raw = String(connectionString || '').trim();
  if (!raw) return { ok: false, error: 'empty_url' };
  try {
    const u = new URL(raw);
    const port = u.port || (u.protocol === 'postgresql:' || u.protocol === 'postgres:' ? '5432' : '');
    return {
      ok: true,
      protocol: u.protocol.replace(/:$/, ''),
      host: u.hostname,
      port: port || null,
      database: u.pathname.replace(/^\//, '') || null,
      is_session_port: port === '5432' || (!u.port && true),
      is_transaction_port: port === '6543',
      has_user: Boolean(u.username),
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 120) };
  }
}

/**
 * Ops smoke: connect → SELECT 1 → end. No crawl, no embed.
 * @param {any} env
 * @param {{ attempts?: number, via?: 'session'|'hyperdrive'|'direct'|'auto' }} [opts]
 */
export async function smokeCodeIndexPgConnect(env, opts = {}) {
  const viaRaw = String(opts.via || 'auto').trim().toLowerCase();
  const via =
    viaRaw === 'session' || viaRaw === 'pooler'
      ? 'session'
      : viaRaw === 'hyperdrive' || viaRaw === 'hd'
        ? 'hyperdrive'
        : viaRaw === 'direct'
          ? 'direct'
          : 'auto';

  const started = Date.now();
  /** @type {Record<string, unknown>} */
  const out = {
    ok: false,
    via,
    write_pipe: null,
    select_1: false,
    attempts: 0,
    elapsed_ms: 0,
    url: null,
    error: null,
    code: null,
  };

  let connectionString;
  try {
    if (via === 'session') {
      connectionString = resolveCodeIndexSessionPoolerUrl(env);
      out.write_pipe = 'supabase_session_pooler';
    } else if (via === 'hyperdrive') {
      connectionString = resolveCodeIndexHyperdriveUrl(env);
      out.write_pipe = 'hyperdrive';
    } else if (via === 'direct') {
      connectionString = resolveCodeIndexDirectDbUrl(env);
      out.write_pipe = 'supabase_direct_db';
    } else {
      const resolved = resolveCodeIndexWriteConnection(env);
      connectionString = resolved.connectionString;
      out.write_pipe = resolved.write_pipe;
      out.via = resolved.write_pipe === 'hyperdrive' ? 'hyperdrive' : 'session';
    }
    out.url = summarizeCodeIndexSessionPoolerUrl(connectionString);
  } catch (e) {
    out.error = String(e?.message || e).slice(0, 240);
    out.code = e?.code != null ? String(e.code) : 'resolve_failed';
    out.elapsed_ms = Date.now() - started;
    return out;
  }

  if (out.url && typeof out.url === 'object' && out.url.is_transaction_port) {
    out.error = 'code_index_transaction_pooler_forbidden:use_session_pooler_5432';
    out.code = 'code_index_transaction_pooler_forbidden';
    out.elapsed_ms = Date.now() - started;
    return out;
  }

  const maxAttempts = Math.min(5, Math.max(1, Number(opts.attempts) || CONNECT_RETRY_ATTEMPTS));
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    out.attempts = attempt;
    let client = null;
    try {
      client = await connectCodeIndexPgClientWithUrl(connectionString);
      const ping = await client.query('SELECT 1 AS ok');
      out.select_1 = Number(ping?.rows?.[0]?.ok) === 1 || ping?.rows?.[0]?.ok === true;
      out.ok = out.select_1 === true;
      out.elapsed_ms = Date.now() - started;
      return out;
    } catch (e) {
      lastErr = e;
      out.error = String(e?.message || e).slice(0, 240);
      out.code = e?.code != null ? String(e.code) : 'connect_or_query_failed';
      if (!isCodeIndexPgTransientError(e) || attempt >= maxAttempts) break;
      console.warn('[code-index-write-pipe] pg_smoke_retry', {
        via: out.via,
        attempt,
        error: out.error,
      });
      await sleepMs(CONNECT_BACKOFF_MS[attempt - 1] ?? 800 * attempt);
    } finally {
      if (client) await client.end().catch(() => {});
    }
  }

  out.ok = false;
  out.select_1 = false;
  out.error = String(lastErr?.message || lastErr || out.error || 'smoke_failed').slice(0, 240);
  out.elapsed_ms = Date.now() - started;
  return out;
}

/** @deprecated Prefer smokeCodeIndexPgConnect(env, { via: 'session' }) */
export async function smokeCodeIndexSessionPoolerConnect(env, opts = {}) {
  return smokeCodeIndexPgConnect(env, { ...opts, via: 'session' });
}

/**
 * Compare session / hyperdrive / direct smokes in one request.
 * @param {any} env
 * @param {{ attempts?: number }} [opts]
 */
export async function smokeCodeIndexPgConnectCompare(env, opts = {}) {
  const attempts = opts.attempts;
  const session = await smokeCodeIndexPgConnect(env, { attempts, via: 'session' });
  const hyperdrive = await smokeCodeIndexPgConnect(env, { attempts, via: 'hyperdrive' });
  const direct = await smokeCodeIndexPgConnect(env, { attempts, via: 'direct' });
  return {
    ok: Boolean(session.ok || hyperdrive.ok || direct.ok),
    smoke: 'code_index_pg_connect_compare',
    session,
    hyperdrive,
    direct,
    recommendation: hyperdrive.ok
      ? 'use_hyperdrive_for_worker_writes'
      : session.ok
        ? 'session_pooler_ok_hyperdrive_failed'
        : direct.ok
          ? 'direct_ok_unexpected_prefer_hyperdrive'
          : 'all_paths_failed_check_supabase_nano_and_credentials',
  };
}

/**
 * Short-lived session: connect (with retry) → callback once → end.
 * Does not re-enter callback on failure.
 *
 * @template T
 * @param {any} env
 * @param {(client: { query: (sql: string, params?: unknown[]) => Promise<any> }) => Promise<T>} callback
 * @returns {Promise<T>}
 */
export async function withCodeIndexPgClient(env, callback) {
  let client = null;
  try {
    client = await connectCodeIndexPgClientWithRetry(env);
    return await callback(client);
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

/**
 * Batch-scoped client: reuse across files, ping/reconnect after idle or dead socket.
 * Call ensureClient() immediately before PG work (not before long embed/GitHub gaps).
 *
 * @param {any} env
 */
export function createCodeIndexPgBatchSession(env) {
  /** @type {import('pg').Client | null} */
  let client = null;
  let lastUsedAt = 0;

  async function endQuiet() {
    const c = client;
    client = null;
    lastUsedAt = 0;
    if (c) await c.end().catch(() => {});
  }

  /**
   * @returns {Promise<import('pg').Client>}
   */
  async function ensureClient() {
    const idleMs = lastUsedAt > 0 ? Date.now() - lastUsedAt : Number.POSITIVE_INFINITY;
    if (isLivePgClient(client) && idleMs < BATCH_IDLE_RECONNECT_MS) {
      try {
        await client.query('SELECT 1');
        lastUsedAt = Date.now();
        return client;
      } catch (e) {
        console.warn('[code-index-write-pipe] batch_client_ping_failed', {
          error: String(e?.message || e).slice(0, 180),
        });
        await endQuiet();
      }
    } else if (client) {
      await endQuiet();
    }
    client = await connectCodeIndexPgClientWithRetry(env);
    lastUsedAt = Date.now();
    return client;
  }

  return {
    ensureClient,
    /**
     * @template T
     * @param {(client: import('pg').Client) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async run(fn) {
      const c = await ensureClient();
      try {
        const out = await fn(c);
        lastUsedAt = Date.now();
        return out;
      } catch (e) {
        if (!isCodeIndexPgTransientError(e)) throw e;
        console.warn('[code-index-write-pipe] batch_client_reconnect', {
          error: String(e?.message || e).slice(0, 180),
        });
        await endQuiet();
        const c2 = await ensureClient();
        const out = await fn(c2);
        lastUsedAt = Date.now();
        return out;
      }
    },
    async close() {
      await endQuiet();
    },
  };
}

/**
 * @param {any} env
 * @param {(client: { query: (sql: string, params?: unknown[]) => Promise<any> }) => Promise<any>} callback
 * @param {{ client?: any }} [opts]
 */
export async function runCodeIndexPgSession(env, callback, opts = {}) {
  const shared = opts.client;
  if (isLivePgClient(shared)) {
    try {
      const result = await callback(shared);
      return {
        ok: true,
        rows: Array.isArray(result?.rows) ? result.rows : [],
        result,
        meta: {
          path: 'code_index_write',
          write_pipe: resolveCodeIndexWriteConnection(env).write_pipe,
          reused_client: true,
        },
      };
    } catch (e) {
      return { ok: false, rows: [], error: e?.message ? String(e.message) : String(e) };
    }
  }

  try {
    const result = await withCodeIndexPgClient(env, callback);
    return {
      ok: true,
      rows: Array.isArray(result?.rows) ? result.rows : [],
      result,
      meta: {
        path: 'code_index_write',
        write_pipe: resolveCodeIndexWriteConnection(env).write_pipe,
        reused_client: false,
      },
    };
  } catch (e) {
    if (isCodeIndexPgPoolWaitError(e) || e?.code === 'code_index_pg_pool_wait_hard_fail') {
      return {
        ok: false,
        rows: [],
        error: e?.message ? String(e.message) : String(e),
        code: 'code_index_pg_pool_wait_hard_fail',
      };
    }
    return { ok: false, rows: [], error: e?.message ? String(e.message) : String(e) };
  }
}

/**
 * @param {any} env
 * @param {(client: { query: (sql: string, params?: unknown[]) => Promise<any> }) => Promise<any>} callback
 * @param {{ client?: any }} [opts]
 */
export async function runCodeIndexPgTransaction(env, callback, opts = {}) {
  const shared = opts.client;
  if (isLivePgClient(shared)) {
    try {
      await shared.query('BEGIN');
      try {
        const result = await callback(shared);
        await shared.query('COMMIT');
        return {
          ok: true,
          rows: Array.isArray(result?.rows) ? result.rows : [],
          result,
          meta: {
            path: 'code_index_write_tx',
            write_pipe: resolveCodeIndexWriteConnection(env).write_pipe,
            reused_client: true,
          },
        };
      } catch (inner) {
        await shared.query('ROLLBACK').catch(() => {});
        throw inner;
      }
    } catch (e) {
      return { ok: false, rows: [], error: e?.message ? String(e.message) : String(e) };
    }
  }

  try {
    const result = await withCodeIndexPgClient(env, async (client) => {
      await client.query('BEGIN');
      try {
        const out = await callback(client);
        await client.query('COMMIT');
        return out;
      } catch (inner) {
        await client.query('ROLLBACK').catch(() => {});
        throw inner;
      }
    });
    return {
      ok: true,
      rows: Array.isArray(result?.rows) ? result.rows : [],
      result,
      meta: {
        path: 'code_index_write_tx',
        write_pipe: resolveCodeIndexWriteConnection(env).write_pipe,
        reused_client: false,
      },
    };
  } catch (e) {
    if (isCodeIndexPgPoolWaitError(e) || e?.code === 'code_index_pg_pool_wait_hard_fail') {
      return {
        ok: false,
        rows: [],
        error: e?.message ? String(e.message) : String(e),
        code: 'code_index_pg_pool_wait_hard_fail',
      };
    }
    return { ok: false, rows: [], error: e?.message ? String(e.message) : String(e) };
  }
}

/**
 * @param {any} env
 * @param {string} sql
 * @param {unknown[]} [params]
 * @param {{ client?: any }} [opts]
 */
export async function runCodeIndexPgQuery(env, sql, params = [], opts = {}) {
  const session = await runCodeIndexPgSession(
    env,
    async (client) => client.query(sql, params),
    opts,
  );
  if (!session.ok) {
    return { ok: false, rows: [], error: session.error, code: session.code };
  }
  return {
    ok: true,
    rows: session.result?.rows ?? session.rows ?? [],
    meta: session.meta,
  };
}

export const CODE_INDEX_WRITE_PIPE = Object.freeze({
  bulk: 'hyperdrive_preferred_session_fallback',
  retrieve: 'hyperdrive',
  control_plane: 'd1',
  ban: Object.freeze([
    'hyperdrive_url_in_SUPABASE_DB_URL',
    'transaction_pooler_6543',
    'connect_per_call',
    'connect_per_chunk',
  ]),
});
