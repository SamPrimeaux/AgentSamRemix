/**
 * Shared helpers for the settings-sections family (settings-sections-*.js).
 * Defensive D1 access, secret redaction, and response envelope shaping used
 * by every settings-sections-* module.
 * Deconstructed from src/api/settings-sections.js (Sections peel SEC1, no
 * behavior change).
 */

const TEXT_MASK = '************';

function nowIso() {
  return new Date().toISOString();
}

function unixSeconds() {
  return Math.floor(Date.now() / 1000);
}

/** True iff a D1 table exists. Result cached per-request via the passed map. */
async function tableExists(db, name, cache) {
  if (cache && cache.has(name)) return cache.get(name);
  let exists = false;
  try {
    const row = await db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1`)
      .bind(name)
      .first();
    exists = !!row;
  } catch (_) {
    exists = false;
  }
  if (cache) cache.set(name, exists);
  return exists;
}

/** Defensive table query that returns [] and pushes a warning if the table is missing. */
async function safeQueryAll(db, table, sql, binds, warnings, cache) {
  const ok = await tableExists(db, table, cache);
  if (!ok) {
    warnings.push({
      code: 'SOURCE_TABLE_NOT_FOUND',
      message: `The expected table ${table} was not found, so its rows are not shown yet.`,
      severity: 'info',
      table,
    });
    return [];
  }
  try {
    const stmt = db.prepare(sql);
    const res = binds && binds.length ? await stmt.bind(...binds).all() : await stmt.all();
    return Array.isArray(res?.results) ? res.results : [];
  } catch (e) {
    warnings.push({
      code: 'SOURCE_QUERY_FAILED',
      message: `Query against ${table} failed: ${e?.message || String(e)}`,
      severity: 'warn',
      table,
    });
    return [];
  }
}

async function safeFirst(db, table, sql, binds, warnings, cache) {
  const ok = await tableExists(db, table, cache);
  if (!ok) {
    warnings.push({
      code: 'SOURCE_TABLE_NOT_FOUND',
      message: `The expected table ${table} was not found, so its rows are not shown yet.`,
      severity: 'info',
      table,
    });
    return null;
  }
  try {
    const stmt = db.prepare(sql);
    const row = binds && binds.length ? await stmt.bind(...binds).first() : await stmt.first();
    return row || null;
  } catch (e) {
    warnings.push({
      code: 'SOURCE_QUERY_FAILED',
      message: `Query against ${table} failed: ${e?.message || String(e)}`,
      severity: 'warn',
      table,
    });
    return null;
  }
}

function stripSecretFields(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const lk = k.toLowerCase();
    if (
      lk.includes('token') ||
      lk.includes('secret') ||
      lk.includes('api_key') ||
      lk.includes('apikey') ||
      lk.includes('refresh') ||
      lk.includes('access_key') ||
      lk.includes('client_secret') ||
      lk.includes('encrypted_value') ||
      lk === 'value'
    ) {
      out[k] = v == null ? null : TEXT_MASK;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function envelope(section, body) {
  return {
    ok: true,
    generated_at: Date.now(),
    section,
    summary: body.summary || {},
    rows: body.rows || [],
    warnings: body.warnings || [],
    actions: body.actions || [],
    providers: body.providers || undefined,
    // GitHub (and others) put code_index_jobs / audit_log / oauth here — must not drop.
    ...(body.extra != null && typeof body.extra === 'object' ? { extra: body.extra } : {}),
  };
}
export { nowIso, unixSeconds, tableExists, safeQueryAll, safeFirst, stripSecretFields, envelope };
