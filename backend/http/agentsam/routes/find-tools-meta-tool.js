/**
 * find_tools meta-tool: keyword catalog discovery for Agent Sam (progressive hydrate).
 *
 * Not MCP tools/list — that handshake dumps full oauth_visible schemas for OAuth clients.
 * This tool returns a ranked keyword match from agentsam_tools; the agent loop hydrates
 * full schemas for matched keys into activeTools. Execution risk/approval stays at call time.
 *
 * Routed as meta so catalog handler_type=d1|agent never hits Database Studio
 * (explicit_d1_resource_required).
 *
 * Matching: token OR + tool_key-weighted ranking (no stopword deny-lists).
 * Prefer exact / multi-term tool_key coverage; demote `_mcp_` unless the query asks for mcp.
 */

function trim(v) {
  return String(v ?? '').trim();
}

/**
 * True for find_tools + agentsam_search_tools aliases — platform env.DB discovery only.
 * @param {string} rawKey
 */
export function isCatalogDiscoveryMetaTool(rawKey) {
  const key = String(rawKey || '').trim().toLowerCase();
  return (
    key === 'find_tools' ||
    key === 'find-tools' ||
    key === 'agentsam_find_tools' ||
    key === 'agentsam_search_tools' ||
    key === 'search_tools' ||
    key === 'search-tools'
  );
}

/**
 * Infer discovery query from loose model args (no Studio D1 resource required).
 * @param {Record<string, unknown>|string|null|undefined} input
 * @param {Record<string, unknown>} [runContext]
 */
export function normalizeFindToolsInput(input = {}, runContext = {}) {
  const raw =
    input == null
      ? {}
      : typeof input === 'string'
        ? { query: input }
        : typeof input === 'object' && !Array.isArray(input)
          ? { ...input }
          : {};
  const candidates = [
    raw.query,
    raw.intent,
    raw.q,
    raw.search,
    raw.keyword,
    raw.keywords,
    raw.text,
    raw.prompt,
    raw.message,
    raw.value,
  ];
  let query = '';
  for (const c of candidates) {
    const t = trim(c);
    if (t) {
      query = t;
      break;
    }
  }
  if (!query) {
    query = trim(runContext.userMessage ?? runContext.message ?? runContext.user_message ?? '');
  }
  return {
    ...raw,
    query,
    intent: trim(raw.intent) || undefined,
    workspace_id: trim(raw.workspace_id) || undefined,
    mode: trim(raw.mode) || undefined,
    limit: raw.limit,
  };
}

function safeJsonParse(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function normalizeToolRow(row) {
  const schema = safeJsonParse(row.input_schema, row.input_schema || null);
  const workspaceScope = safeJsonParse(row.workspace_scope, row.workspace_scope || null);
  return {
    name: trim(row.tool_key) || trim(row.tool_code) || trim(row.tool_name),
    tool_key: trim(row.tool_key),
    tool_code: trim(row.tool_code),
    display_name: trim(row.display_name) || trim(row.tool_name) || trim(row.tool_key),
    description: trim(row.description),
    category: trim(row.tool_category),
    handler_type: trim(row.handler_type),
    risk_level: trim(row.risk_level) || 'low',
    input_schema: schema,
    requires_approval: row.requires_approval === 1 || row.requires_approval === true,
    workspace_scope: workspaceScope,
  };
}

/**
 * Split query fields into tokens — keep all tokens (no stopword deny-list).
 * @param {Record<string, unknown>} input
 * @returns {string[]}
 */
export function discoverySearchTerms(input = {}) {
  const blob = [
    trim(input.query),
    trim(input.intent),
    trim(input.mode),
    trim(input.q),
    trim(input.search),
    trim(input.keyword),
    trim(input.keywords),
  ]
    .join(' ')
    .toLowerCase();

  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const raw of blob.split(/[^a-z0-9_.-]+/)) {
    const t = raw.trim();
    if (t.length < 2) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 12) break;
  }
  if (!out.length) {
    const q = trim(input.query || input.intent || '')
      .toLowerCase()
      .replace(/[%_]/g, '');
    if (q && q.length >= 2 && q.length <= 96 && !/\s/.test(q)) out.push(q);
  }
  return out;
}

/**
 * True when discovery tokens imply the user wants image/video generation tools.
 * "visual" / bare "image" next to HTML/file language must NOT qualify (handoff bug).
 * Require imgx/veo/png/photo OR (image|video + generate).
 * @param {string[]} terms
 */
export function discoveryTermsWantMediaTools(terms) {
  const list = (Array.isArray(terms) ? terms : [])
    .map((t) => String(t || '').toLowerCase().trim())
    .filter(Boolean);
  if (list.some((t) => /^(imgx|veo|dalle|png|jpe?g|webp|gif|mp4|photo|photos)$/.test(t))) {
    return true;
  }
  const hasImageWord = list.some((t) => /^(image|images|video|videos|illustration)$/.test(t));
  const hasGenerate = list.some((t) => /^(generate|generation|draw|render)$/.test(t));
  return hasImageWord && hasGenerate;
}

/**
 * @param {string} toolKey
 */
export function isMediaGenerationCatalogToolKey(toolKey) {
  return /^(imgx_|veo_|moviemode_)/i.test(String(toolKey || '').trim());
}

/**
 * Rank a catalog row for discovery. Tool_key coverage >> description noise.
 * @param {Record<string, unknown>} row
 * @param {string[]} terms
 * @returns {number}
 */
export function scoreCatalogToolRow(row, terms) {
  const list = Array.isArray(terms) ? terms.filter(Boolean) : [];
  if (!list.length) return 0;

  const toolKey = trim(row.tool_key || row.tool_name || row.name).toLowerCase();
  const toolCode = trim(row.tool_code).toLowerCase();
  const display = trim(row.display_name).toLowerCase();
  const desc = trim(row.description).toLowerCase();
  const category = trim(row.tool_category || row.category).toLowerCase();
  const capability = trim(row.capability_key).toLowerCase();

  let score = 0;
  let keyHits = 0;
  let anyHits = 0;

  for (const t of list) {
    const term = String(t).toLowerCase();
    if (!term) continue;
    if (toolKey === term || toolCode === term) {
      score += 1000;
      keyHits += 1;
      anyHits += 1;
      continue;
    }
    let hit = false;
    if (toolKey.includes(term) || toolCode.includes(term)) {
      score += 50;
      keyHits += 1;
      hit = true;
    }
    if (display.includes(term)) {
      score += 15;
      hit = true;
    }
    if (category.includes(term) || capability.includes(term)) {
      score += 10;
      hit = true;
    }
    if (desc.includes(term)) {
      score += 3;
      hit = true;
    }
    if (hit) anyHits += 1;
  }

  // Multi-term coverage on tool_key is the primary signal (beats single-token MCP noise).
  if (list.length > 1 && keyHits > 0) {
    score += Math.round((keyHits / list.length) * 200);
  }
  if (list.length > 1 && anyHits > 0) {
    score += Math.round((anyHits / list.length) * 40);
  }

  // Prefer canonical in-app tools over GitHub MCP wrappers unless the query asks for mcp.
  const wantsMcp = list.some((t) => t === 'mcp');
  if (!wantsMcp && toolKey.includes('_mcp_')) {
    score -= 200;
  }

  // Intent boosts: commits / r2 should surface canonical tools ahead of noisy list_* MCP keys.
  const wantsCommits = list.some((t) => /commit/.test(t));
  if (wantsCommits && /list_commits$/.test(toolKey)) {
    score += 400;
  }
  const wantsR2 = list.some((t) => t === 'r2' || t.startsWith('r2_'));
  if (wantsR2 && /^agentsam_r2_/.test(toolKey) && !toolKey.includes('_mcp_')) {
    score += 300;
  }
  if (wantsR2 && /_r2_list$/.test(toolKey)) {
    score += 150;
  }

  // Ticket / D1 inspect: tkt_* or "ticket" must surface ticket_get + d1_query over memory noise.
  const wantsTicket =
    list.some((t) => t === 'ticket' || t.startsWith('tkt_') || t === 'tickets') ||
    list.some((t) => /^tkt_[a-z0-9_]+$/i.test(t));
  const wantsD1 =
    wantsTicket ||
    list.some((t) => t === 'd1' || t.startsWith('d1_') || t === 'sql' || t === 'query');
  if (wantsTicket && toolKey === 'agentsam_ticket') score += 500;
  if (wantsTicket && toolKey === 'agentsam_ticket_get') score += 200;
  if (wantsTicket && toolKey === 'agentsam_ticket_list') score += 100;
  if (wantsD1 && toolKey === 'agentsam_d1_query') score += 450;
  if (wantsTicket && toolKey === 'agentsam_memory_search') score -= 120;

  // tkt_search_tools_rank_media_last: HTML/"visual" must not float imgx_/veo_.
  if (isMediaGenerationCatalogToolKey(toolKey) && !discoveryTermsWantMediaTools(list)) {
    score -= 800;
  }

  // Mild preference for shorter, more specific keys when scores are close.
  score -= Math.min(20, Math.floor(toolKey.length / 8));

  return score;
}

function coreFallbackTools() {
  return [
    {
      name: 'find_tools',
      tool_key: 'find_tools',
      tool_code: 'find_tools',
      display_name: 'Find tools',
      description: 'Discover Agent Sam catalog tools by capability, intent, category, or name.',
      category: 'agent.discovery',
      handler_type: 'meta',
      risk_level: 'low',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          intent: { type: 'string' },
          workspace_id: { type: 'string' },
          mode: { type: 'string' },
        },
        required: ['query'],
      },
      requires_approval: false,
      workspace_scope: ['*'],
    },
  ];
}

/**
 * @param {any} env
 * @param {{ query?: string, intent?: string, workspace_id?: string, mode?: string, limit?: number }} input
 * @param {Record<string, unknown>} runContext
 */
export async function executeFindToolsMetaTool(env, input = {}, runContext = {}) {
  const normalized = normalizeFindToolsInput(input, runContext);
  const q = trim(normalized.query || normalized.intent || '');
  // Model often passes limit:5 — too small for hydrate; floor so commits tools can surface.
  const limit = Math.max(12, Math.min(Number(normalized.limit || 24) || 24, 64));
  const searchTerms = discoverySearchTerms(normalized);
  const workspaceId = trim(
    normalized.workspace_id || runContext.workspaceId || runContext.workspace_id,
  );

  if (!env?.DB) {
    console.warn(
      '[find_tools] core_fallback_no_db',
      JSON.stringify({
        query: q || null,
        workspace_id: workspaceId || null,
        note: 'env.DB missing at call site — returning stub only (binding may still exist on Worker)',
      }),
    );
    return {
      ok: true,
      result: {
        query: q,
        tools: coreFallbackTools(),
        source: 'core_fallback',
      },
    };
  }

  const binds = [];
  let where = `COALESCE(is_active, 1) = 1 AND COALESCE(is_degraded, 0) = 0`;
  if (searchTerms.length) {
    const termClauses = [];
    for (const term of searchTerms) {
      const like = `%${term.replace(/[%_]/g, '')}%`;
      termClauses.push(`(
        lower(COALESCE(tool_key, '')) LIKE ? OR
        lower(COALESCE(tool_code, '')) LIKE ? OR
        lower(COALESCE(tool_name, '')) LIKE ? OR
        lower(COALESCE(display_name, '')) LIKE ? OR
        lower(COALESCE(description, '')) LIKE ? OR
        lower(COALESCE(tool_category, '')) LIKE ? OR
        lower(COALESCE(handler_type, '')) LIKE ? OR
        lower(COALESCE(capability_key, '')) LIKE ?
      )`);
      binds.push(like, like, like, like, like, like, like, like);
    }
    where += ` AND (${termClauses.join(' OR ')})`;
  }
  if (workspaceId) {
    where += ` AND (
      COALESCE(is_global, 0) = 1
      OR workspace_scope IS NULL
      OR workspace_scope = ''
      OR workspace_scope = '*'
      OR workspace_scope LIKE '%"*"%'
      OR workspace_scope LIKE ?
    )`;
    binds.push(`%${workspaceId}%`);
  }

  const sql = `SELECT id, tool_key, tool_code, tool_name, display_name, description,
                      tool_category, handler_type, capability_key, input_schema,
                      risk_level, requires_approval, workspace_scope, is_global
               FROM agentsam_tools
               WHERE ${where}
               LIMIT ${Math.max(limit * 8, 96)}`;

  let rows = [];
  try {
    const res = await env.DB.prepare(sql).bind(...binds).all();
    rows = Array.isArray(res?.results) ? res.results : [];
  } catch (e) {
    return {
      ok: false,
      error: `find_tools catalog query failed: ${e?.message ?? String(e)}`,
    };
  }

  const ranked = rows
    .map((row) => ({ row, score: scoreCatalogToolRow(row, searchTerms) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.row.tool_key || '').length - String(b.row.tool_key || '').length;
    })
    .slice(0, limit);

  const tools = ranked.map(({ row }) => normalizeToolRow(row));

  return {
    ok: true,
    result: {
      query: q,
      search_terms: searchTerms,
      intent: trim(normalized.intent) || null,
      mode: trim(normalized.mode) || null,
      workspace_id: workspaceId || null,
      count: tools.length,
      tools: [...tools, ...coreFallbackTools()].filter(
        (tool, idx, arr) => arr.findIndex((t) => t.name === tool.name) === idx,
      ),
      rows: tools,
      top_scores: ranked.slice(0, 8).map(({ row, score }) => ({
        tool_key: row.tool_key,
        score,
      })),
      trace_event: 'tools_discovered',
      source: 'agentsam_tools',
      via: 'find_tools_meta',
    },
  };
}
