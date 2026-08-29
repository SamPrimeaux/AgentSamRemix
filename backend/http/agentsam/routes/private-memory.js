/**
 * Private managed operational memory — canonical: agentsam.agentsam_memory (Hyperdrive).
 * D1 agentsam_memory = edge cache / MCP compatibility. No public.* writes.
 * Vectorize optional (embedding NULL by default).
 */
import { isHyperdriveUsable, runHyperdriveQuery } from '../../../services/database/hyperdrive.js';
import { MANAGED_MEMORY_TYPES, resolveManagedMemoryType } from '../../../../src/core/mcp-memory-type-compat.js';

export { MANAGED_MEMORY_TYPES };

const TYPE_PRIORITY = {
  error: 1,
  decision: 2,
  policy: 3,
  state: 4,
  fact: 5,
  skill: 6,
  preference: 7,
  project: 8,
};

/**
 * @param {string} tenantId
 * @param {string} userId
 * @param {string} memoryKey
 */
export function buildMemorySyncKey(tenantId, userId, memoryKey) {
  return `${String(tenantId).trim()}:${String(userId).trim()}:${String(memoryKey).trim()}`;
}

/**
 * @param {Record<string, unknown>} input
 */
export function normalizePrivateMemoryInput(input) {
  const memoryKey = String(
    input.memory_key ?? input.key ?? input.memoryKey ?? '',
  ).trim();
  const content = String(
    input.content ?? input.value ?? input.body ?? '',
  ).trim();
  const resolved = resolveManagedMemoryType(input);
  const memoryType = resolved.memory_type;
  let valueJson = input.value_json ?? input.valueJson ?? {};
  if (typeof valueJson === 'string') {
    try {
      valueJson = JSON.parse(valueJson);
    } catch {
      valueJson = { raw: valueJson };
    }
  }
  if (!valueJson || typeof valueJson !== 'object' || Array.isArray(valueJson)) {
    valueJson = {};
  }
  let tags = input.tags ?? [];
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags);
    } catch {
      tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(tags)) tags = [];
  if (resolved.tags?.length) {
    tags = [...new Set([...tags, ...resolved.tags])];
  }

  return {
    tenant_id: String(input.tenant_id ?? input.tenantId ?? '').trim(),
    workspace_id: String(input.workspace_id ?? input.workspaceId ?? '').trim(),
    user_id: String(input.user_id ?? input.userId ?? '').trim(),
    memory_type: memoryType,
    memory_key: memoryKey,
    title: input.title != null ? String(input.title).slice(0, 500) : null,
    content,
    summary:
      input.summary != null
        ? String(input.summary).slice(0, 2000)
        : content.slice(0, 400),
    value_json: valueJson,
    source: String(input.source ?? 'agent_sam').slice(0, 120),
    external_ref:
      input.external_ref != null ? String(input.external_ref).slice(0, 200) : null,
    tags,
    confidence: Math.min(1, Math.max(0, Number(input.confidence ?? 1))),
    importance: Math.min(10, Math.max(1, Math.floor(Number(input.importance ?? 5)))),
    expires_at: input.expires_at ?? input.expiresAt ?? null,
    is_pinned: Boolean(input.is_pinned ?? input.isPinned),
    sync_key:
      String(input.sync_key ?? input.syncKey ?? '').trim() ||
      (input.tenant_id && input.user_id && memoryKey
        ? buildMemorySyncKey(
            String(input.tenant_id ?? input.tenantId),
            String(input.user_id ?? input.userId),
            memoryKey,
          )
        : ''),
    d1_id: input.d1_id != null ? String(input.d1_id) : null,
  };
}

/**
 * @param {Record<string, unknown>} row
 */
export function mapD1RowToPrivateMemory(row) {
  const tenantId = String(row.tenant_id ?? '').trim();
  const userId = String(row.user_id ?? '').trim();
  const memoryKey = String(row.key ?? row.memory_key ?? '').trim();
  const content = String(row.value ?? row.content ?? '').trim();
  let tags = row.tags;
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags);
    } catch {
      tags = [];
    }
  }
  return normalizePrivateMemoryInput({
    tenant_id: tenantId,
    workspace_id: row.workspace_id,
    user_id: userId,
    memory_type: row.memory_type,
    memory_key: memoryKey,
    title: row.title,
    content,
    summary: row.summary ?? content.slice(0, 400),
    value_json: row.value_json ?? { d1_value: content },
    source: row.source ?? 'd1_mirror',
    tags: Array.isArray(tags) ? tags : [],
    confidence: row.confidence,
    importance: row.importance ?? 5,
    expires_at:
      row.expires_at != null && Number(row.expires_at) > 0
        ? new Date(Number(row.expires_at) * 1000).toISOString()
        : null,
    is_pinned: row.is_pinned === 1 || row.is_pinned === true,
    sync_key: row.sync_key || buildMemorySyncKey(tenantId, userId, memoryKey),
    d1_id: row.id != null ? String(row.id) : null,
  });
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} memory
 * @param {{ ctx?: { waitUntil?: (p: Promise<unknown>) => void } }} [opts]
 */
export async function upsertPrivateAgentsamMemory(env, memory, opts = {}) {
  const m = normalizePrivateMemoryInput(memory);
  if (!m.tenant_id || !m.workspace_id || !m.user_id || !m.memory_key || !m.content) {
    return { ok: false, error: 'missing_required_fields' };
  }
  if (!MANAGED_MEMORY_TYPES.includes(m.memory_type)) {
    return { ok: false, error: 'invalid_memory_type', memory_type: m.memory_type };
  }
  if (!m.sync_key) {
    m.sync_key = buildMemorySyncKey(m.tenant_id, m.user_id, m.memory_key);
  }

  if (!isHyperdriveUsable(env)) {
    return { ok: false, error: 'hyperdrive_unavailable', sync_key: m.sync_key };
  }

  const sql = `
    INSERT INTO agentsam.agentsam_memory (
      tenant_id, workspace_id, user_id, memory_type, memory_key,
      title, content, summary, value_json, source, external_ref, tags,
      confidence, importance, expires_at, is_pinned, is_archived,
      embedding, embedded_at, sync_key, d1_id, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9::jsonb, $10, $11, $12::text[],
      $13, $14, $15::timestamptz, $16, false,
      NULL, NULL, $17, $18, now()
    )
    ON CONFLICT (tenant_id, user_id, memory_key) DO UPDATE SET
      workspace_id = EXCLUDED.workspace_id,
      memory_type = EXCLUDED.memory_type,
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      summary = EXCLUDED.summary,
      value_json = EXCLUDED.value_json,
      source = EXCLUDED.source,
      external_ref = COALESCE(EXCLUDED.external_ref, agentsam.agentsam_memory.external_ref),
      tags = EXCLUDED.tags,
      confidence = EXCLUDED.confidence,
      importance = EXCLUDED.importance,
      expires_at = EXCLUDED.expires_at,
      is_pinned = EXCLUDED.is_pinned,
      sync_key = EXCLUDED.sync_key,
      d1_id = COALESCE(EXCLUDED.d1_id, agentsam.agentsam_memory.d1_id),
      updated_at = now()
    RETURNING id, memory_key, sync_key, memory_type`;

  const binds = [
    m.tenant_id,
    m.workspace_id,
    m.user_id,
    m.memory_type,
    m.memory_key,
    m.title,
    m.content,
    m.summary,
    JSON.stringify(m.value_json),
    m.source,
    m.external_ref,
    m.tags,
    m.confidence,
    m.importance,
    m.expires_at,
    m.is_pinned,
    m.sync_key,
    m.d1_id,
  ];

  const r = await runHyperdriveQuery(env, sql, binds);
  if (!r.ok) {
    console.warn('[failed_memory_mirror]', {
      sync_key: m.sync_key,
      memory_key: m.memory_key,
      error: r.error || 'upsert_failed',
    });
    return { ok: false, error: r.error || 'upsert_failed', sync_key: m.sync_key };
  }
  const row = r.rows?.[0] ?? {};
  return {
    ok: true,
    id: row.id,
    memory_key: row.memory_key ?? m.memory_key,
    sync_key: row.sync_key ?? m.sync_key,
    memory_type: row.memory_type ?? m.memory_type,
  };
}

/**
 * @param {any} env
 * @param {Record<string, unknown>} d1Row
 * @param {{ ctx?: { waitUntil?: (p: Promise<unknown>) => void } }} [opts]
 */
export async function mirrorD1MemoryToPrivatePg(env, d1Row, opts = {}) {
  const mapped = mapD1RowToPrivateMemory(d1Row);
  const run = () =>
    upsertPrivateAgentsamMemory(env, mapped, opts).catch((e) => {
      console.warn('[failed_memory_mirror]', mapped.sync_key, e?.message ?? e);
      return { ok: false, error: String(e?.message ?? e) };
    });
  if (opts?.ctx?.waitUntil) {
    opts.ctx.waitUntil(run());
    return { ok: true, scheduled: true, sync_key: mapped.sync_key };
  }
  return run();
}

/**
 * @param {any} env
 * @param {{
 *   tenantId: string,
 *   workspaceId?: string|null,
 *   userId: string,
 *   query?: string,
 *   memoryType?: string,
 *   memoryKey?: string,
 *   tags?: string[],
 *   limit?: number,
 *   includeContent?: boolean,
 *   contentMaxChars?: number,
 * }} opts
 */
export async function searchPrivateAgentsamMemory(env, opts) {
  const tenantId = String(opts.tenantId ?? '').trim();
  const userId = String(opts.userId ?? '').trim();
  const workspaceId = String(opts.workspaceId ?? '').trim();
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 50);
  const q = String(opts.query ?? '').trim();
  const contentSelect =
    opts.includeContent === false
      ? 'NULL::text AS content'
      : `LEFT(content, ${Math.min(Math.max(Number(opts.contentMaxChars) || 12000, 1), 12000)}) AS content`;

  // Hard scope — never search without tenant + user + workspace (no cross-tenant bleed).
  if (!tenantId || !userId || !workspaceId) {
    return { ok: false, error: 'missing_scope', results: [] };
  }
  if (!isHyperdriveUsable(env)) {
    return { ok: false, error: 'hyperdrive_unavailable', results: [] };
  }

  const conditions = [
    'tenant_id = $1',
    'user_id = $2',
    'workspace_id = $3',
    'is_archived = false',
    '(expires_at IS NULL OR expires_at > now())',
  ];
  const binds = [tenantId, userId, workspaceId];
  let n = 4;

  if (opts.memoryKey) {
    conditions.push(`memory_key = $${n}`);
    binds.push(String(opts.memoryKey));
    n += 1;
  }
  if (opts.memoryType) {
    conditions.push(`memory_type = $${n}`);
    binds.push(String(opts.memoryType));
    n += 1;
  }
  if (q) {
    const pat = `%${q.replace(/%/g, '\\%')}%`;
    conditions.push(
      `(memory_key ILIKE $${n} OR content ILIKE $${n} OR COALESCE(summary,'') ILIKE $${n} OR COALESCE(title,'') ILIKE $${n})`,
    );
    binds.push(pat);
    n += 1;
  }

  binds.push(limit);
  const sql = `
    SELECT id, memory_key, memory_type, title, ${contentSelect}, summary, source, tags,
           confidence, importance, is_pinned, updated_at, sync_key
    FROM agentsam.agentsam_memory
    WHERE ${conditions.join(' AND ')}
    ORDER BY
      is_pinned DESC,
      importance DESC,
      CASE memory_type
        WHEN 'error' THEN 1 WHEN 'decision' THEN 2 WHEN 'policy' THEN 3 WHEN 'state' THEN 4
        WHEN 'fact' THEN 5 WHEN 'skill' THEN 6 WHEN 'preference' THEN 7 WHEN 'project' THEN 8
        ELSE 9
      END,
      updated_at DESC
    LIMIT $${n}`;

  const r = await runHyperdriveQuery(env, sql, binds);
  if (!r.ok) {
    return { ok: false, error: r.error, results: [] };
  }
  return { ok: true, results: r.rows ?? [], tier: q ? 'trgm_ilike' : 'scoped' };
}

/**
 * Pinned/high-importance Hyperdrive SELECT. Banned from buildSystemPrompt —
 * every chat turn raced this at 1500ms and left pool clients running after
 * timeout (same Hyperdrive pool the code indexer saturates).
 * Later chat recall: Vectorize AGENTSAM_VECTORIZE_MEMORY
 * (src/core/agentsam-memory-hybrid-search.js). Keep this for explicit/on-demand
 * callers only.
 *
 * @param {any} env
 * @param {{ tenantId: string, workspaceId: string, userId: string, limit?: number }} ctx
 * @returns {Promise<string>}
 */
export async function loadPinnedMemoryDigestForPrompt(env, ctx = {}) {
  const tenantId = String(ctx.tenantId ?? '').trim();
  const workspaceId = String(ctx.workspaceId ?? '').trim();
  const userId = String(ctx.userId ?? '').trim();
  const limit = Math.min(Math.max(Number(ctx.limit) || 16, 1), 24);

  if (!tenantId || !workspaceId || !userId) return '';
  if (!isHyperdriveUsable(env)) return '';

  try {
    const r = await runHyperdriveQuery(
      env,
      `SELECT memory_type, memory_key, title, content, summary, importance, is_pinned
       FROM agentsam.agentsam_memory
       WHERE tenant_id = $1
         AND user_id = $2
         AND workspace_id = $3
         AND is_archived = false
         AND (expires_at IS NULL OR expires_at > now())
         AND (is_pinned = true OR importance >= 8)
       ORDER BY is_pinned DESC, importance DESC, updated_at DESC
       LIMIT $4`,
      [tenantId, userId, workspaceId, limit],
    );
    if (!r.ok || !r.rows?.length) return '';
    return formatPrivateMemoryBlock(r.rows);
  } catch (e) {
    console.warn('[private-memory] digest failed', e?.message ?? e);
    return '';
  }
}

/**
 * Message-aware private memory for prompts. Hard-requires tenant + user + workspace.
 * @param {any} env
 * @param {{
 *   tenantId: string,
 *   workspaceId: string,
 *   userId: string,
 *   userMessage?: string,
 *   limit?: number,
 * }} ctx
 */
export async function loadPrivateMemoryForPrompt(env, ctx = {}) {
  const tenantId = String(ctx.tenantId ?? '').trim();
  const workspaceId = String(ctx.workspaceId ?? '').trim();
  const userId = String(ctx.userId ?? '').trim();
  const q = String(ctx.userMessage ?? '').trim();

  if (!tenantId || !workspaceId || !userId || !isHyperdriveUsable(env)) return '';

  const { results } = await searchPrivateAgentsamMemory(env, {
    tenantId,
    workspaceId,
    userId,
    query: q.length >= 4 ? q.slice(0, 500) : undefined,
    limit: ctx.limit ?? 12,
  });
  if (!results?.length) return '';
  return formatPrivateMemoryBlock(results);
}

/**
 * @param {Record<string, unknown>[]} rows
 */
function formatPrivateMemoryBlock(rows) {
  const lines = rows.map((r) => {
    const t = String(r.memory_type || 'fact').toUpperCase();
    const k = r.memory_key ?? r.key;
    const body = r.summary || r.content || r.value || '';
    const pin = r.is_pinned ? ' [pinned]' : '';
    return `[${t}] ${k}${pin}: ${String(body).slice(0, 600)}`;
  });
  return `\n## Private Agent Memory (${lines.length})\n${lines.join('\n')}\n`;
}

/**
 * @param {any} env
 * @param {{ tenantId: string, userId: string, workspaceId: string }} ctx
 * @param {string} oldKey
 * @param {string} newKey
 */
export async function markMemorySuperseded(env, ctx, oldKey, newKey) {
  if (!isHyperdriveUsable(env)) return { ok: false, error: 'hyperdrive_unavailable' };
  const sql = `
    UPDATE agentsam.agentsam_memory AS old
    SET superseded_by = (
      SELECT id FROM agentsam.agentsam_memory
      WHERE tenant_id = $1 AND user_id = $2 AND memory_key = $4
      LIMIT 1
    ),
    is_archived = true,
    updated_at = now()
    WHERE old.tenant_id = $1 AND old.user_id = $2 AND old.memory_key = $3`;
  const r = await runHyperdriveQuery(env, sql, [
    ctx.tenantId,
    ctx.userId,
    oldKey,
    newKey,
  ]);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/**
 * @param {any} env
 * @param {{ tenantId: string, userId: string }} ctx
 * @param {string} memoryKey
 */
export async function archivePrivateMemory(env, ctx, memoryKey) {
  if (!isHyperdriveUsable(env)) return { ok: false, error: 'hyperdrive_unavailable' };
  const r = await runHyperdriveQuery(
    env,
    `UPDATE agentsam.agentsam_memory
     SET is_archived = true, updated_at = now()
     WHERE tenant_id = $1 AND user_id = $2 AND memory_key = $3`,
    [ctx.tenantId, ctx.userId, memoryKey],
  );
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/**
 * MCP memory write failure helper — never claim saved on 401.
 * @param {any} env
 * @param {{
 *   tenantId: string,
 *   workspaceId: string,
 *   userId: string,
 *   toolName: string,
 *   attemptedKey: string,
 *   ctx?: { waitUntil?: (p: Promise<unknown>) => void },
 * }} o
 */
export async function recordMcpMemoryAuthFailure(env, o) {
  const content =
    `${o.toolName} returned 401 reauthentication required while saving memory key "${o.attemptedKey}". ` +
    'Re-authenticate the IAM MCP connector, then retry. Use Worker private memory API or D1 agentsam_memory as fallback until auth is restored.';
  const d1Payload = {
    tenant_id: o.tenantId,
    user_id: o.userId,
    workspace_id: o.workspaceId,
    memory_type: 'error',
    key: 'error:mcp_memory_save_401_reauth',
    value: content,
    source: 'chatgpt_observed_failure',
    tags: JSON.stringify(['mcp', 'memory', 'auth', 'external-ai', 'repair']),
  };

  let d1Ok = false;
  if (env?.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO agentsam_memory (
           tenant_id, user_id, workspace_id, memory_type, key, value, source, tags,
           confidence, decay_score, updated_at
         ) VALUES (?, ?, ?, 'error', ?, ?, ?, ?, 1.0, 1.0, unixepoch())
         ON CONFLICT(tenant_id, user_id, key) DO UPDATE SET
           value = excluded.value,
           source = excluded.source,
           tags = excluded.tags,
           updated_at = unixepoch()`,
      )
        .bind(
          o.tenantId,
          o.userId,
          o.workspaceId,
          d1Payload.key,
          content,
          d1Payload.source,
          d1Payload.tags,
        )
        .run();
      d1Ok = true;
    } catch (e) {
      console.warn('[mcp_memory_auth_failure] d1', e?.message ?? e);
    }
  }

  const pg = await upsertPrivateAgentsamMemory(
    env,
    {
      tenant_id: o.tenantId,
      workspace_id: o.workspaceId,
      user_id: o.userId,
      memory_type: 'error',
      memory_key: 'error:mcp_memory_save_401_reauth',
      title: 'MCP memory save failed due to reauthentication required',
      content,
      summary: content.slice(0, 400),
      value_json: { tool: o.toolName, attempted_key: o.attemptedKey },
      source: 'chatgpt_observed_failure',
      tags: ['mcp', 'memory', 'auth', 'external-ai', 'repair'],
      importance: 8,
      is_pinned: true,
    },
    { ctx: o.ctx },
  );

  return {
    ok: false,
    error: 'reauth_required',
    reauth_required: true,
    failed_tool: o.toolName,
    tool_name: o.toolName,
    attempted_key: o.attemptedKey,
    user_message:
      'IAM MCP connector needs reauthentication before memory can be saved. Reconnect MCP in ChatGPT/Claude/Cursor settings, then retry.',
    manual_fallback: {
      memory_key: o.attemptedKey,
      d1_saved: d1Ok,
      private_pg_saved: pg.ok === true,
    },
    memory_persisted: d1Ok || pg.ok === true,
  };
}

/**
 * @param {unknown} err
 * @param {Response|null} res
 */
export function isMcpReauthError(err, res = null) {
  if (res?.status === 401) return true;
  const msg = String(err instanceof Error ? err.message : err ?? '').toLowerCase();
  return msg.includes('401') && (msg.includes('reauth') || msg.includes('unauthorized'));
}

export { TYPE_PRIORITY as PRIVATE_MEMORY_TYPE_PRIORITY };
