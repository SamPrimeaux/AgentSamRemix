/**
 * Route codebase retrieve by query type before touching stores.
 * Structural (exact name / calls / exports) → D1 only.
 * Semantic (fuzzy "related to") → pgvector. Escalate only when D1 cannot answer.
 */

/** @typedef {'structural'|'semantic'} CodebaseRetrieveRoute */
/** @typedef {'name_lookup'|'calls_graph'|'exports'|'imports_graph'|'semantic'} CodebaseRetrieveIntent */

/**
 * @param {unknown} raw
 * @returns {'auto'|'structural'|'semantic'}
 */
export function normalizeRetrieveMode(raw) {
  const v = String(raw ?? 'auto')
    .toLowerCase()
    .trim();
  if (v === 'structural' || v === 'd1' || v === 'exact' || v === 'graph') return 'structural';
  if (v === 'semantic' || v === 'ann' || v === 'fuzzy' || v === 'pgvector') return 'semantic';
  return 'auto';
}

/**
 * Pull a symbol / file target out of a natural-language structural question.
 * @param {string} query
 * @returns {{
 *   name: string|null,
 *   file_path: string|null,
 *   exported_only: boolean,
 *   graph_direction: 'both'|'in'|'out'|null,
 *   edge_types: string[]|null,
 *   intent: CodebaseRetrieveIntent,
 * }}
 */
export function extractStructuralTarget(query) {
  const q = String(query || '').trim();
  const empty = {
    name: null,
    file_path: null,
    exported_only: false,
    graph_direction: null,
    edge_types: null,
    intent: /** @type {CodebaseRetrieveIntent} */ ('name_lookup'),
  };
  if (!q) return empty;

  let graph_direction = /** @type {'both'|'in'|'out'|null} */ (null);
  let edge_types = /** @type {string[]|null} */ (null);
  let exported_only = false;
  let intent = /** @type {CodebaseRetrieveIntent} */ ('name_lookup');

  if (
    /\b(who|what)\s+calls\b/i.test(q) ||
    /\bcallers?\s+of\b/i.test(q) ||
    (/\bcallers?\b/i.test(q) && /\bof\b/i.test(q))
  ) {
    graph_direction = 'in';
    edge_types = ['calls'];
    intent = 'calls_graph';
  } else if (
    /\bwhat\s+does\s+.+\s+call\b/i.test(q) ||
    /\bcallees?\s+of\b/i.test(q) ||
    /\bwhat\s+does\s+\S+\s+call\b/i.test(q)
  ) {
    graph_direction = 'out';
    edge_types = ['calls'];
    intent = 'calls_graph';
  } else if (/\bwhat\s+imports\b/i.test(q) || /\bimports?\s+(from|of)\b/i.test(q)) {
    graph_direction = 'out';
    edge_types = ['imports'];
    intent = 'imports_graph';
  } else if (
    /\bwhat\s+does\s+.+\s+export/i.test(q) ||
    /\bexports?\s+(from|of|in)\b/i.test(q) ||
    /\bexported\s+(by|from)\b/i.test(q)
  ) {
    exported_only = true;
    intent = 'exports';
  }

  /** @type {string|null} */
  let name = null;
  /** @type {string|null} */
  let file_path = null;

  const tick = q.match(/`([^`]+)`/);
  const single = q.match(/'([A-Za-z_$][\w$]*)'/);
  const dbl = q.match(/"([A-Za-z_$][\w$]*)"/);
  if (tick) {
    const raw = tick[1].trim();
    if (/[./]/.test(raw) || /\.(js|ts|tsx|jsx|mjs|cjs|py|go|rs)$/i.test(raw)) {
      file_path = raw;
    } else {
      name = raw.includes('.') ? raw.split('.').pop() || raw : raw;
    }
  } else if (single) {
    name = single[1];
  } else if (dbl) {
    name = dbl[1];
  }

  if (!name && !file_path) {
    const def = q.match(
      /\b(?:function|class|method|const|let|var|type|interface|enum|symbol)\s+([A-Za-z_$][\w$]*)\b/i,
    );
    if (def) name = def[1];
  }

  if (!name && !file_path) {
    const defines = q.match(
      /\b(?:defines?|definition\s+of|where\s+is|file\s+defines)\s+([A-Za-z_$][\w$]*)\b/i,
    );
    if (defines) name = defines[1];
  }

  if (!name && !file_path && intent === 'calls_graph') {
    const callsOf = q.match(/\b(?:calls|callers?\s+of|callees?\s+of)\s+([A-Za-z_$][\w$]*)\b/i);
    if (callsOf) name = callsOf[1];
    const whatDoesCall = q.match(/\bwhat\s+does\s+([A-Za-z_$][\w$]*)\s+call\b/i);
    if (!name && whatDoesCall) name = whatDoesCall[1];
  }

  if (!file_path && intent === 'exports') {
    const fileExport = q.match(
      /\b(?:file|module|path)\s+[`'"]?([^\s`'"]+\.[A-Za-z0-9]+)[`'"]?/i,
    );
    if (fileExport) file_path = fileExport[1];
    const fromPath = q.match(/\b(?:from|in|of)\s+[`'"]?([^\s`'"]+\.[A-Za-z0-9]+)[`'"]?/i);
    if (!file_path && fromPath) file_path = fromPath[1];
  }

  if (!name && !file_path) {
    const bare = q.match(/^([A-Za-z_$][\w$]*)$/);
    if (bare) name = bare[1];
  }

  if (!name && !file_path) {
    // Last resort: longest Identifier-looking token (skip stopwords).
    const stop = new Set([
      'what',
      'where',
      'who',
      'which',
      'does',
      'did',
      'the',
      'a',
      'an',
      'is',
      'are',
      'was',
      'were',
      'file',
      'files',
      'function',
      'functions',
      'class',
      'method',
      'define',
      'defines',
      'defined',
      'definition',
      'call',
      'calls',
      'caller',
      'callers',
      'callee',
      'callees',
      'export',
      'exports',
      'exported',
      'import',
      'imports',
      'from',
      'of',
      'in',
      'to',
      'for',
      'and',
      'or',
      'code',
      'related',
      'similar',
      'find',
      'show',
      'list',
      'get',
    ]);
    const tokens = (q.match(/[A-Za-z_$][\w$]{2,}/g) || []).filter(
      (t) => !stop.has(t.toLowerCase()),
    );
    if (tokens.length === 1) name = tokens[0];
    else if (tokens.length > 1) {
      // Prefer CamelCase / snake_case over plain english
      const ranked = [...tokens].sort((a, b) => {
        const score = (t) =>
          (/[A-Z]/.test(t) ? 2 : 0) + (/_/.test(t) ? 2 : 0) + Math.min(t.length, 24) / 24;
        return score(b) - score(a);
      });
      if (/[A-Z_]/.test(ranked[0]) || ranked[0].length >= 6) name = ranked[0];
    }
  }

  return { name, file_path, exported_only, graph_direction, edge_types, intent };
}

/**
 * Classify before any store access.
 * @param {string} query
 * @param {{ mode?: unknown, intent?: unknown }} [opts]
 * @returns {{
 *   route: CodebaseRetrieveRoute,
 *   intent: CodebaseRetrieveIntent,
 *   mode: 'auto'|'structural'|'semantic',
 *   target: ReturnType<typeof extractStructuralTarget>,
 *   reason: string,
 * }}
 */
export function classifyCodebaseRetrieveIntent(query, opts = {}) {
  const mode = normalizeRetrieveMode(opts.mode ?? opts.intent);
  const q = String(query || '').trim();
  const target = extractStructuralTarget(q);

  if (mode === 'structural') {
    return {
      route: 'structural',
      intent: target.intent,
      mode,
      target,
      reason: 'explicit_structural',
    };
  }
  if (mode === 'semantic') {
    return {
      route: 'semantic',
      intent: 'semantic',
      mode,
      target,
      reason: 'explicit_semantic',
    };
  }

  if (
    /\b(related\s+to|similar\s+to|find\s+code\s+(like|about|for)|how\s+(do|does|to)|implementation\b|approach\b|pattern\b)/i.test(
      q,
    )
  ) {
    return {
      route: 'semantic',
      intent: 'semantic',
      mode,
      target,
      reason: 'semantic_phrase',
    };
  }

  if (
    target.intent === 'calls_graph' ||
    target.intent === 'exports' ||
    target.intent === 'imports_graph' ||
    /\b(where\s+is|what\s+file\s+defines|definition\s+of|defines?\s+)\b/i.test(q)
  ) {
    if (target.name || target.file_path) {
      return {
        route: 'structural',
        intent: target.intent,
        mode,
        target,
        reason: 'structural_phrase',
      };
    }
  }

  // Bare or near-bare identifier → exact D1 name lookup (no embed).
  if (target.name && /^[A-Za-z_$][\w$]*$/.test(q.replace(/[`'"]/g, '').trim())) {
    return {
      route: 'structural',
      intent: 'name_lookup',
      mode,
      target,
      reason: 'bare_identifier',
    };
  }

  if (target.name && q.split(/\s+/).length <= 6) {
    const looksStructural =
      /\b(define|defined|definition|export|exports|import|imports|call|calls|caller|callee|file|symbol|function|class)\b/i.test(
        q,
      ) || /^[A-Za-z_$][\w$.]+$/.test(q);
    if (looksStructural) {
      return {
        route: 'structural',
        intent: target.intent,
        mode,
        target,
        reason: 'short_structural',
      };
    }
  }

  return {
    route: 'semantic',
    intent: 'semantic',
    mode,
    target,
    reason: 'default_semantic',
  };
}

/**
 * Exact / prefix structural lookup in D1 codebase_ast_nodes.
 * @param {any} env
 * @param {{
 *   workspaceId: string,
 *   name?: string|null,
 *   file_path?: string|null,
 *   repo?: string|null,
 *   exported_only?: boolean,
 *   limit?: number,
 * }} opts
 */
export async function lookupAstSymbolsExact(env, opts = {}) {
  const db = env?.DB;
  if (!db) return { ok: false, error: 'd1_unavailable', hits: [] };
  const workspaceId = String(opts.workspaceId || '').trim();
  if (!workspaceId) return { ok: false, error: 'workspace_id_required', hits: [] };

  const name = opts.name != null ? String(opts.name).trim() : '';
  const filePath = opts.file_path != null ? String(opts.file_path).trim() : '';
  if (!name && !filePath) return { ok: false, error: 'structural_target_required', hits: [] };

  const limit = Math.min(Math.max(Number(opts.limit) || 16, 1), 48);
  const repo =
    opts.repo_full_name != null
      ? String(opts.repo_full_name).trim()
      : opts.repo != null
        ? String(opts.repo).trim()
        : '';
  const generationId =
    opts.index_generation_id != null && String(opts.index_generation_id).trim()
      ? String(opts.index_generation_id).trim()
      : opts.indexGenerationId != null && String(opts.indexGenerationId).trim()
        ? String(opts.indexGenerationId).trim()
        : '';
  const exportedOnly = Boolean(opts.exported_only);

  const clauses = ['workspace_id = ?'];
  /** @type {unknown[]} */
  const binds = [workspaceId];

  if (repo) {
    clauses.push('repo_full_name = ?');
    binds.push(repo);
  }
  if (generationId) {
    clauses.push('index_generation_id = ?');
    binds.push(generationId);
  }
  if (exportedOnly) {
    clauses.push('is_exported = 1');
  }
  if (filePath) {
    clauses.push('(file_path = ? OR file_path LIKE ?)');
    binds.push(filePath, `%/${filePath.replace(/^\/+/, '')}`);
  }
  if (name) {
    clauses.push('(node_name = ? OR node_name LIKE ?)');
    binds.push(name, `${name}%`);
  }

  const sql = `
    SELECT id, node_type, node_name, file_path, repo_full_name, signature, line_start, line_end, is_exported
      FROM codebase_ast_nodes
     WHERE ${clauses.join(' AND ')}
     ORDER BY CASE WHEN node_name = ? THEN 0 ELSE 1 END, file_path, line_start
     LIMIT ?
  `;
  binds.push(name || '', limit);

  try {
    const res = await db.prepare(sql).bind(...binds).all();
    const hits = (res?.results || []).map((row) => ({
      node_id: row.id,
      node_type: row.node_type,
      node_name: row.node_name,
      file_path: row.file_path,
      repo: row.repo_full_name || row.repo,
      signature: row.signature,
      line_start: row.line_start,
      line_end: row.line_end,
      is_exported: row.is_exported,
      score: name && row.node_name === name ? 1 : 0.85,
    }));
    return { ok: true, hits, backend: 'd1_ast_nodes' };
  } catch (e) {
    return {
      ok: false,
      error: e?.message != null ? String(e.message) : String(e),
      hits: [],
    };
  }
}
