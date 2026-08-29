/**
 * Cloudflare D1 catalog lane.
 * Face = Bindings MCP d1_database_query: { database_id, sql, params }.
 * Auth = caller CF credentials. No workspace / tenant / studio targeting.
 */
import {
  buildCloudflareD1AuthCtx,
  normalizeCloudflareD1QueryFace,
} from './d1-query-tool-contract.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

export function isCatalogCfD1Operation(toolKey, config) {
  const key = String(toolKey || '').trim();
  if (/^agentsam_d1_/i.test(key)) return true;
  const resource = String(config?.resource || '').toLowerCase();
  if (resource === 'd1') return true;
  const op = String(config?.operation || '').toLowerCase();
  return op.startsWith('d1.') || op === 'd1';
}

export function normalizeCatalogCfD1Op(config, toolKey) {
  let op = String(config?.operation || '').toLowerCase();
  if (op.startsWith('d1.')) op = op.slice(3);
  if (op === 'd1') op = 'query';
  if (op === 'migrate' || op === 'execute') op = 'write';
  if (!op) {
    const key = String(toolKey || '').toLowerCase();
    if (key.includes('write') || key.includes('delete') || key.includes('migrate')) return 'write';
    return 'query';
  }
  return op;
}

function trimDatabaseId(databaseId) {
  return databaseId != null && String(databaseId).trim() ? String(databaseId).trim() : null;
}

/** Lift database_id to the payload the model actually reads — not only body.meta. */
export function attachCatalogCfD1DatabaseId(payload, databaseId) {
  const id = trimDatabaseId(databaseId);
  const base = payload && typeof payload === 'object' ? payload : {};
  const meta =
    base.meta && typeof base.meta === 'object' ? { ...base.meta, database_id: id } : { database_id: id };
  return { ...base, database_id: id, meta };
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Read-only follow-up so a miss returns the real catalog in the same turn.
 * Never CREATE. Never PRAGMA a table that does not exist.
 *
 * @param {{ kind: string, table?: string|null } | null|undefined} hint
 */
export function catalogCfD1RecoverySql(hint) {
  if (!hint) return null;
  if (hint.kind === 'no_such_column' && hint.table && IDENT_RE.test(hint.table)) {
    return `PRAGMA table_info(${hint.table})`;
  }
  return `SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name LIMIT 200`;
}

function skipSchemaRecovery(sqlForHints) {
  const s = String(sqlForHints || '');
  return /\bsqlite_master\b/i.test(s) || /PRAGMA\s+table_info/i.test(s);
}

/**
 * Best-effort table name for schema recovery (FROM / JOIN / UPDATE / INTO).
 * @param {string} sqlForHints
 * @returns {string|null}
 */
export function guessSqlTableForSchemaHint(sqlForHints) {
  const sql = String(sqlForHints || '');
  const patterns = [
    /\bfrom\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)/i,
    /\bjoin\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)/i,
    /\bupdate\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)/i,
    /\binto\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(sql);
    const name = m?.[1] ? String(m[1]).trim() : '';
    if (name && IDENT_RE.test(name)) return name;
  }
  return null;
}

function recoveryMessage(hint, recovery, dbLabel) {
  const rows = Array.isArray(recovery?.rows) ? recovery.rows : [];
  if (hint.kind === 'no_such_column') {
    const cols = rows.map((r) => r?.name).filter(Boolean);
    if (cols.length) {
      const missing = trim(hint.missing_column);
      let alt = '';
      if (missing && missing.endsWith('_unix')) {
        const bare = missing.replace(/_unix$/, '');
        if (cols.includes(bare)) {
          alt = ` Column ${missing} is absent; ${hint.table} has ${bare} (legacy TEXT) — use PRAGMA or pick an INTEGER *_unix column from the list.`;
        }
      }
      if (!alt && missing && !cols.includes(missing)) {
        const near = cols.filter((c) => c.includes(missing) || missing.includes(c)).slice(0, 4);
        if (near.length) alt = ` Did you mean: ${near.join(', ')}?`;
      }
      return ` — database_id=${dbLabel}. Columns on ${hint.table}: ${cols.join(', ')}.${alt}`;
    }
  }
  const names = rows.map((r) => r?.name).filter(Boolean);
  const shown = names.slice(0, 40).join(', ');
  const more = names.length > 40 ? ` (+${names.length - 40} more)` : '';
  if (!names.length) {
    return ` — table not found in database_id=${dbLabel}. This database has no user tables/views — confirm database_id before CREATE.`;
  }
  return ` — table not found in database_id=${dbLabel}. Objects in this database: ${shown}${more}. Confirm database_id before assuming the table needs creating.`;
}

/**
 * Split SQLite schema errors. Combined handling was a wasted-run bug:
 * PRAGMA table_info(missing_table) returns zero rows with no error, so the
 * agent treats "wrong database_id / table does not exist" as "table with no columns."
 *
 * Always echo database_id on the result the model reads (success and failure).
 * On schema miss, run the recovery SELECT/PRAGMA in this same call so the
 * agent sees the real catalog instead of burning a retry.
 *
 * @param {string} errText
 * @param {string} sqlForHints
 * @param {string|null|undefined} databaseId
 * @returns {{
 *   kind: 'no_such_table'|'no_such_column',
 *   table: string|null,
 *   database_id: string|null,
 *   user_message_suffix: string,
 * } | null}
 */
export function catalogCfD1SchemaErrorHint(errText, sqlForHints, databaseId) {
  const text = String(errText || '');
  const resolvedDbId = databaseId != null && String(databaseId).trim() ? String(databaseId).trim() : null;
  const dbLabel = resolvedDbId || '(unknown)';
  // D1 wraps SQLite as "no such table: foo: SQLITE_ERROR" — do not let \S+ eat the colon.
  const noSuchTable = /no such table:?\s+["'`]?([A-Za-z_][A-Za-z0-9_.]*)/i.exec(text);
  if (noSuchTable) {
    return {
      kind: 'no_such_table',
      table: noSuchTable[1] || null,
      database_id: resolvedDbId,
      user_message_suffix:
        ` — table not found in database_id=${dbLabel}. ` +
        `Retry with sql = SELECT name FROM sqlite_master WHERE type IN ('table','view') to see what actually exists in this database -- confirm database_id is correct before assuming the table needs creating.`,
    };
  }
  const noSuchColumn = /no such column:?\s+["'`]?([A-Za-z_][A-Za-z0-9_.]*)/i.exec(text);
  if (noSuchColumn) {
    const tableGuess = guessSqlTableForSchemaHint(sqlForHints);
    const missingColumn = noSuchColumn[1] || null;
    return {
      kind: 'no_such_column',
      table: tableGuess || null,
      missing_column: missingColumn,
      database_id: resolvedDbId,
      user_message_suffix:
        ` — database_id=${dbLabel}.` +
        (tableGuess
          ? ` Column "${missingColumn || '?'}" is not on ${tableGuess}. Real columns are attached in recovery.rows (from PRAGMA table_info). Rewrite the SELECT using those names.`
          : " Retry with sql = SELECT name FROM sqlite_master WHERE type IN ('table','view') to list tables."),
    };
  }
  return null;
}

/**
 * Guided D1 schema failure — includes inline recovery catalog for the model (do not throw away).
 * @param {unknown} value
 */
export function isCatalogCfD1GuidedSchemaFailure(value) {
  if (!value || typeof value !== 'object') return false;
  const o = /** @type {Record<string, unknown>} */ (value);
  if (o.schema_hint && typeof o.schema_hint === 'object') return true;
  if (o.recovery && typeof o.recovery === 'object') return true;
  const um = trim(o.user_message);
  return Boolean(um && (/PRAGMA table_info/i.test(um) || /Columns on /i.test(um) || /sqlite_master/i.test(um)));
}

/**
 * Normalize catalog CF D1 failure for dispatch + agent tool loop (body + top-level fields).
 * @param {Record<string, unknown>} base
 */
export function attachCatalogCfD1FailureEnvelope(base) {
  const body = {
    ok: false,
    error: base.error ?? null,
    user_message: base.user_message ?? base.error ?? null,
    schema_hint: base.schema_hint ?? null,
    recovery: base.recovery ?? null,
    database_id: base.database_id ?? null,
  };
  return {
    ...base,
    ok: false,
    body,
    user_message: body.user_message,
    hint:
      'Schema mismatch — recovery.rows lists real columns/tables in this database. Rewrite SQL; do not retry the same column names.',
  };
}

async function failCatalogCfD1(env, d1Ctx, errText, sqlForHints, databaseId, extra = {}) {
  const msg = String(errText || extra.error || 'd1_error');
  const hint = catalogCfD1SchemaErrorHint(msg, sqlForHints, databaseId);
  const resolvedDbId = hint?.database_id ?? trimDatabaseId(databaseId);
  if (!hint) {
    return {
      ok: false,
      error: extra.error || msg,
      user_message: extra.user_message || msg,
      database_id: resolvedDbId,
      ...extra.fields,
    };
  }

  /** @type {{ sql: string, rows: unknown[], kind: string } | null} */
  let recovery = null;
  const recoverySql = skipSchemaRecovery(sqlForHints) ? null : catalogCfD1RecoverySql(hint);
  if (recoverySql && env && d1Ctx) {
    try {
      const { executeWorkspaceD1Query } = await import('./workspace-d1-execution.js');
      const rec = await executeWorkspaceD1Query(env, d1Ctx, [{ sql: recoverySql, params: null }]);
      if (rec?.ok) {
        recovery = { sql: recoverySql, rows: rec.rows || [], kind: hint.kind };
      }
    } catch {
      recovery = null;
    }
  }

  const suffix = recovery
    ? recoveryMessage(hint, recovery, resolvedDbId || '(unknown)')
    : hint.user_message_suffix;
  return attachCatalogCfD1FailureEnvelope({
    ok: false,
    error: extra.error || msg,
    user_message: (extra.user_message || msg) + suffix,
    schema_hint: {
      table: hint.table,
      kind: hint.kind,
      missing_column: hint.missing_column ?? null,
    },
    database_id: resolvedDbId,
    recovery,
    ...extra.fields,
  });
}

/**
 * Soft-resolve database_id when the model omits it or passes a CF catalog name.
 * Matches migration 1225 ("omit → workspace pin") and recovers from Gemini-style
 * database_id_required failures without requiring a prior agentsam_cf_d1_list turn.
 *
 * @param {any} env
 * @param {Record<string, unknown>} d1Params
 * @param {Record<string, unknown>} runContext
 * @returns {Promise<string|null>}
 */
async function softResolveCatalogCfD1DatabaseId(env, d1Params, runContext) {
  const p = d1Params && typeof d1Params === 'object' ? d1Params : {};
  const sql = String(p.sql || '').trim();
  if (!sql) return null;

  const { D1_UUID_RE, parseD1DatabaseHint } = await import('./d1-database-hint.js');
  const rawId = String(p.database_id || p.databaseId || '').trim();
  if (D1_UUID_RE.test(rawId)) return rawId;

  const hint = parseD1DatabaseHint(p);
  const nameHint =
    (hint && hint.database_name) ||
    (rawId && !D1_UUID_RE.test(rawId) ? rawId : '') ||
    String(p.database || p.database_name || p.databaseName || '').trim();

  const userId = String(runContext?.userId ?? runContext?.user_id ?? '').trim();
  const workspaceId = String(runContext?.workspaceId ?? runContext?.workspace_id ?? '').trim();
  const authUser = runContext?.authUser ?? runContext?.user ?? null;

  if (nameHint && userId) {
    try {
      const { resolveCallerD1ByNameOrId } = await import('./cf-mcp-proxy.js');
      const byName = await resolveCallerD1ByNameOrId(
        env,
        userId,
        { database: nameHint },
        authUser,
      );
      if (byName?.ok && byName.database_id) return String(byName.database_id).trim();
    } catch {
      /* fall through to pin */
    }
  }

  if (workspaceId) {
    try {
      const { resolveWorkspaceD1Execution } = await import('./workspace-d1-execution.js');
      const resolved = await resolveWorkspaceD1Execution(env, {
        workspace_id: workspaceId,
        user_id: userId,
        tenant_id: runContext?.tenantId ?? runContext?.tenant_id ?? null,
        authUser,
      });
      if (resolved?.ok && resolved.database_id) return String(resolved.database_id).trim();
      const pin = String(resolved?.pinned_database_id || '').trim();
      if (pin) return pin;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} row
 * @param {Record<string, unknown>} config
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} runContext
 */
export async function executeCatalogCfD1(env, row, config, params, runContext) {
  const toolKey = String(
    runContext.agentsam_tool_key ?? row?.tool_key ?? params.tool_key ?? '',
  ).trim();
  const op = normalizeCatalogCfD1Op(config, toolKey);
  const d1Params = params && typeof params === 'object' ? { ...params } : {};
  let face = normalizeCloudflareD1QueryFace(d1Params);
  if (!face.ok && face.error === 'database_id_required') {
    const resolvedId = await softResolveCatalogCfD1DatabaseId(env, d1Params, runContext);
    if (resolvedId) {
      d1Params.database_id = resolvedId;
      face = normalizeCloudflareD1QueryFace(d1Params);
    }
  }
  if (!face.ok) {
    return {
      ok: false,
      error: face.error,
      user_message: face.user_message,
    };
  }
  const d1Ctx = buildCloudflareD1AuthCtx(runContext, face.database_id);
  const statements = face.statements;
  const sqlForHints = statements.map((s) => s.sql).join('\n');

  try {

    const { assertD1SqlNotPostgresOnly } = await import('./d1-postgres-table-guard.js');
    for (const stmt of statements) {
      const pgOnly = assertD1SqlNotPostgresOnly(stmt.sql);
      if (pgOnly.blocked) {
        return {
          ok: false,
          error: pgOnly.error,
          user_message: pgOnly.user_message,
          wrong_data_plane: true,
          database_id: face.database_id,
        };
      }
    }

    if (op === 'query') {
      const { assertD1SqlCompoundSelectBudget } = await import('./d1-read-validator.js');
      for (const stmt of statements) {
        const compoundGate = assertD1SqlCompoundSelectBudget(stmt.sql);
        if (!compoundGate.ok) {
          return {
            ok: false,
            error: compoundGate.error,
            user_message: compoundGate.user_message,
            compound_select_terms: compoundGate.term_count ?? null,
            database_id: face.database_id,
          };
        }
      }
    }

    if (op === 'write') {
      const { executeWorkspaceD1Write } = await import('./workspace-d1-execution.js');
      const writeOut = await executeWorkspaceD1Write(env, d1Ctx, statements, undefined, {
        allow_d1_contract_bypass: params.allow_d1_contract_bypass,
        workerCtx: runContext.ctx ?? runContext.executionCtx ?? null,
        audit: {
          surface: 'catalog_cf_d1',
          tool_name: toolKey || 'agentsam_d1_write',
        },
      });
      if (!writeOut.ok) {
        return failCatalogCfD1(env, d1Ctx, writeOut.user_message || writeOut.error, sqlForHints, writeOut.database_id || face.database_id, {
          error: writeOut.error || 'access_denied',
          user_message: writeOut.user_message,
          fields: { contract: writeOut.contract ?? null },
        });
      }
      return {
        ok: true,
        database_id: face.database_id,
        body: attachCatalogCfD1DatabaseId(
          {
            ...(writeOut.body && typeof writeOut.body === 'object' ? writeOut.body : { result: writeOut.body }),
            data_plane: writeOut.mode,
            meta: writeOut.meta ?? {},
            ...(writeOut.contract_bypass || {}),
          },
          writeOut.meta?.database_id || face.database_id,
        ),
      };
    }

    const { executeWorkspaceD1Query } = await import('./workspace-d1-execution.js');
    const out = await executeWorkspaceD1Query(env, d1Ctx, statements);
    if (out.ok) {
      return {
        ok: true,
        database_id: face.database_id,
        body: attachCatalogCfD1DatabaseId(
          {
            rows: out.rows,
            batch: out.batch,
            statement_count: out.statement_count ?? statements.length,
            data_plane: out.mode,
            meta: out.meta ?? {},
          },
          out.meta?.database_id || face.database_id,
        ),
      };
    }
    return failCatalogCfD1(env, d1Ctx, out.user_message || out.error, sqlForHints, out.database_id || face.database_id, {
      error: out.error,
      user_message: out.user_message,
    });
  } catch (e) {
    // Cloudflare REST /query throws on SQL errors (no such table/column). The
    // !out.ok branch above is not reached unless a caller starts returning
    // structured failures — annotate the throw the same way.
    return failCatalogCfD1(env, d1Ctx, e?.message ?? String(e), sqlForHints, face.database_id);
  }
}
