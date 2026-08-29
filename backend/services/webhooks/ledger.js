/**
 * Canonical inserts into agentsam_webhook_events (production schema: received_at_unix, endpoint_id).
 * Resolves endpoint_id from agentsam_webhooks when omitted.
 */
import { pragmaTableInfo } from '../retention.js';

const EVENTS_TABLE = 'agentsam_webhook_events';
const REGISTRY_TABLE = 'agentsam_webhooks';

/** Compact ledger only — never Payload JSON 2.0. */
export const WEBHOOK_METADATA_MAX_CHARS = 4000;

const WEBHOOK_METADATA_ALLOW = new Set([
  'repo_full_name',
  'branch',
  'commit_sha',
  'commit_message',
  'author_username',
  'worker_name',
  'build_id',
  'created_at_unix',
  'stopped_at_unix',
  'cursor_agent_id',
  'webhook_delivery_id',
  'status',
  'code_index_enqueued',
  'code_index_skipped',
  'code_index_run_id',
  'code_index_mode',
  'workflow_run_id',
  'workflow_triggered',
  'stripe_object',
]);

/** @param {unknown} sha */
function fullGitShaOrNull(sha) {
  const s = sha != null ? String(sha).trim().toLowerCase() : '';
  return /^[a-f0-9]{40}$/.test(s) ? s : null;
}

/** @param {unknown} raw */
function unixFromUnknown(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw > 1e12 ? Math.floor(raw / 1000) : Math.floor(raw);
  }
  const n = Date.parse(String(raw));
  return Number.isFinite(n) ? Math.floor(n / 1000) : null;
}

/**
 * @param {unknown} payload
 * @param {Record<string, unknown> | null | undefined} extra
 * @returns {Record<string, unknown>}
 */
export function compactWebhookMetadataObject(payload, extra) {
  /** @type {Record<string, unknown>} */
  const out = {};
  const put = (key, val) => {
    if (!WEBHOOK_METADATA_ALLOW.has(key)) return;
    if (val == null || val === '') return;
    out[key] = val;
  };

  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    for (const [k, v] of Object.entries(extra)) put(k, v);
  }

  const repo = extractGithubRepoFromWebhookPayload(payload, extra);
  if (repo) put('repo_full_name', repo);
  const worker = extractWorkerNameFromWebhookPayload(payload, extra);
  if (worker) put('worker_name', worker);

  const root = payload && typeof payload === 'object' ? /** @type {Record<string, unknown>} */ (payload) : null;
  const nested =
    root?.payload && typeof root.payload === 'object'
      ? /** @type {Record<string, unknown>} */ (root.payload)
      : root;
  const trigger =
    nested?.buildTriggerMetadata && typeof nested.buildTriggerMetadata === 'object'
      ? /** @type {Record<string, unknown>} */ (nested.buildTriggerMetadata)
      : null;
  const source =
    nested?.source && typeof nested.source === 'object'
      ? /** @type {Record<string, unknown>} */ (nested.source)
      : root?.source && typeof root.source === 'object'
        ? /** @type {Record<string, unknown>} */ (root.source)
        : null;

  if (trigger) {
    const sha = fullGitShaOrNull(trigger.commitHash || trigger.commit_sha);
    if (sha) put('commit_sha', sha);
    const br = trigger.branchName || trigger.branch;
    if (br) put('branch', String(br).slice(0, 200));
    const msg = trigger.commitMessage || trigger.commit_message;
    if (msg) put('commit_message', String(msg).slice(0, 200));
    const bid = nested?.id || trigger.buildUUID || trigger.buildId;
    if (bid) put('build_id', String(bid).slice(0, 120));
    const created = unixFromUnknown(nested?.createdAt || nested?.created_at);
    if (created) put('created_at_unix', created);
    const stopped = unixFromUnknown(nested?.stoppedAt || nested?.stopped_at);
    if (stopped) put('stopped_at_unix', stopped);
  }

  if (root?.repository && typeof root.repository === 'object') {
    const ref = /** @type {any} */ (root).ref;
    if (typeof ref === 'string' && ref.startsWith('refs/heads/')) {
      put('branch', ref.slice('refs/heads/'.length).slice(0, 200));
    }
    const head = /** @type {any} */ (root).head_commit || /** @type {any} */ (root).head;
    const sha = fullGitShaOrNull(head?.id || root.after);
    if (sha) put('commit_sha', sha);
  }

  if (source?.buildUUID) put('build_id', String(source.buildUUID).slice(0, 120));
  if (nested?.id && !out.build_id) put('build_id', String(nested.id).slice(0, 120));

  if (typeof out.commit_sha === 'string') {
    const sha = fullGitShaOrNull(out.commit_sha);
    if (sha) out.commit_sha = sha;
    else delete out.commit_sha;
  }
  if (typeof out.commit_message === 'string') {
    out.commit_message = out.commit_message.slice(0, 200);
  }

  return out;
}

/**
 * @param {unknown} payload
 * @param {Record<string, unknown> | null | undefined} extra
 * @returns {string}
 */
export function stringifyCompactWebhookMetadata(payload, extra) {
  const obj = compactWebhookMetadataObject(payload, extra);
  try {
    return JSON.stringify(obj).slice(0, WEBHOOK_METADATA_MAX_CHARS);
  } catch {
    return '{}';
  }
}

/**
 * Merge a small patch into an existing metadata_json string (still capped).
 * @param {string | null | undefined} currentJson
 * @param {Record<string, unknown>} patch
 */
export function mergeWebhookMetadataJson(currentJson, patch) {
  let current = {};
  try {
    current = JSON.parse(String(currentJson || '{}'));
  } catch {
    current = {};
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) current = {};
  return stringifyCompactWebhookMetadata(null, { ...current, ...(patch || {}) });
}

/** @param {string} status */
function normalizeWebhookLedgerStatus(status) {
  const s = String(status || 'received').trim().toLowerCase();
  if (s === 'processed' || s === 'failed' || s === 'ignored' || s === 'received') return s;
  if (s === 'duplicate' || s === 'processing') return s === 'duplicate' ? 'ignored' : 'received';
  return 'received';
}

/** @returns {string} */
export function newWebhookEventId() {
  return `whe_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/**
 * @param {any} env
 * @param {string | null | undefined} [override]
 */
/**
 * Webhook audit tenant — explicit caller context only (no hardcoded tenant ids).
 * @param {unknown} _env
 * @param {string | null | undefined} override
 */
export function resolveWebhookTenantId(_env, override) {
  if (override == null) return null;
  const s = String(override).trim();
  if (!s || s === 'system') return null;
  return s;
}

/** @param {string | null | undefined} raw */
export function normalizeGithubRepoFullName(raw) {
  if (raw == null || !String(raw).trim()) return null;
  let s = String(raw).trim().replace(/\.git$/i, '');
  s = s.replace(/^https?:\/\/github\.com\//i, '');
  s = s.replace(/^github\.com\//i, '');
  const m = /^[\w.-]+\/[\w.-]+/.exec(s);
  return m ? m[0] : null;
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string | null | undefined} repoFullName
 */
async function lookupWorkspaceScopeByGithubRepo(db, repoFullName) {
  const repo = normalizeGithubRepoFullName(repoFullName);
  if (!repo) return null;
  try {
    const { results } = await db
      .prepare(
        `SELECT id, tenant_id FROM agentsam_workspace
         WHERE lower(replace(replace(replace(trim(github_repo), 'https://github.com/', ''), 'http://github.com/', ''), '.git', '')) = lower(?)
            OR trim(github_repo) = ?
            OR lower(trim(github_repo)) = lower(?)
         LIMIT 2`,
      )
      .bind(repo, repo, repo)
      .all();
    const rows = Array.isArray(results) ? results : [];
    if (rows.length !== 1) return null;
    const row = rows[0];
    if (!row?.tenant_id || !String(row.tenant_id).trim()) return null;
    return {
      tenantId: String(row.tenant_id).trim(),
      workspaceId: row.id != null ? String(row.id).trim() : null,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve tenant/workspace from WORKSPACE_ID binding or explicit workspace id.
 * @param {any} env
 * @param {string | null | undefined} [workspaceId]
 */
export async function resolvePlatformWebhookScope(env, workspaceId) {
  const db = env?.DB;
  if (!db) return null;
  let ws =
    workspaceId != null && String(workspaceId).trim()
      ? String(workspaceId).trim()
      : env?.WORKSPACE_ID != null
        ? String(env.WORKSPACE_ID).trim()
        : '';
  if (!ws) {
    try {
      const { resolveCronWorkspaceId } = await import('../../jobs/cron-tenant.js');
      ws = (await resolveCronWorkspaceId(env)) || '';
    } catch {
      ws = '';
    }
  }
  if (!ws) return null;
  try {
    const row = await db
      .prepare(`SELECT id, tenant_id FROM agentsam_workspace WHERE id = ? LIMIT 1`)
      .bind(ws)
      .first();
    if (!row?.tenant_id || !String(row.tenant_id).trim()) {
      // Workspace row missing tenant — still accept explicit platform TENANT_ID secret.
      try {
        const { resolveCronTenantId } = await import('../../jobs/cron-tenant.js');
        const tid = await resolveCronTenantId(env);
        if (tid) return { tenantId: tid, workspaceId: ws };
      } catch {
        return null;
      }
    }
    return {
      tenantId: String(row.tenant_id).trim(),
      workspaceId: row.id != null ? String(row.id).trim() : ws,
    };
  } catch {
    return null;
  }
}

/**
 * Pull Cloudflare Worker script name from Workers Builds payloads (source.workerName).
 * @param {unknown} payload
 * @param {Record<string, unknown> | null | undefined} [metadata]
 * @returns {string | null}
 */
export function extractWorkerNameFromWebhookPayload(payload, metadata) {
  const fromMeta =
    metadata?.worker_name ?? metadata?.workerName ?? metadata?.cf_worker_name ?? null;
  if (fromMeta != null && String(fromMeta).trim()) return String(fromMeta).trim();

  const root = payload && typeof payload === 'object' ? /** @type {Record<string, unknown>} */ (payload) : null;
  if (!root) return null;

  const nestedPayload =
    root.payload && typeof root.payload === 'object'
      ? /** @type {Record<string, unknown>} */ (root.payload)
      : root;
  const source =
    (nestedPayload.source && typeof nestedPayload.source === 'object'
      ? /** @type {Record<string, unknown>} */ (nestedPayload.source)
      : null) ||
    (root.source && typeof root.source === 'object'
      ? /** @type {Record<string, unknown>} */ (root.source)
      : null);

  const candidates = [
    source?.workerName,
    source?.worker_name,
    nestedPayload.workerName,
    nestedPayload.worker_name,
    root.workerName,
    root.worker_name,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim()) return String(c).trim();
  }
  return null;
}

/**
 * Pull github owner/repo from Workers Builds (or similar) notification payloads.
 * @param {unknown} payload
 * @param {Record<string, unknown> | null | undefined} [metadata]
 * @returns {string | null}
 */
export function extractGithubRepoFromWebhookPayload(payload, metadata) {
  const fromMeta =
    metadata?.repo_full_name ??
    metadata?.github_repo ??
    metadata?.repository_full_name ??
    metadata?.repo ??
    null;
  if (fromMeta) return normalizeGithubRepoFullName(fromMeta);

  const root = payload && typeof payload === 'object' ? /** @type {Record<string, unknown>} */ (payload) : null;
  if (!root) return null;

  const nestedPayload =
    root.payload && typeof root.payload === 'object'
      ? /** @type {Record<string, unknown>} */ (root.payload)
      : root;
  const trigger =
    nestedPayload.buildTriggerMetadata && typeof nestedPayload.buildTriggerMetadata === 'object'
      ? /** @type {Record<string, unknown>} */ (nestedPayload.buildTriggerMetadata)
      : null;

  if (trigger) {
    const account = String(trigger.providerAccountName || trigger.owner || '').trim();
    const repo = String(trigger.repoName || trigger.repository || '').trim();
    if (account && repo) return normalizeGithubRepoFullName(`${account}/${repo}`);
    if (repo.includes('/')) return normalizeGithubRepoFullName(repo);
  }

  // Cursor Cloud Agents: source.repository is a github URL string.
  const cursorSource =
    nestedPayload.source && typeof nestedPayload.source === 'object'
      ? /** @type {Record<string, unknown>} */ (nestedPayload.source)
      : root.source && typeof root.source === 'object'
        ? /** @type {Record<string, unknown>} */ (root.source)
        : null;
  if (cursorSource?.repository != null) {
    const fromCursor = normalizeGithubRepoFullName(cursorSource.repository);
    if (fromCursor) return fromCursor;
  }

  return normalizeGithubRepoFullName(
    (root.repository && typeof root.repository === 'object'
      ? /** @type {any} */ (root.repository).full_name
      : typeof root.repository === 'string'
        ? root.repository
        : null) ??
      (nestedPayload.repository && typeof nestedPayload.repository === 'object'
        ? /** @type {any} */ (nestedPayload.repository).full_name
        : typeof nestedPayload.repository === 'string'
          ? nestedPayload.repository
          : null) ??
      root.repo_full_name ??
      nestedPayload.repo_full_name ??
      null,
  );
}

/**
 * Resolve NOT NULL tenant_id + optional workspace_id for agentsam_webhook_events inserts.
 * @param {any} env
 * @param {Parameters<typeof insertAgentsamWebhookEvent>[1]} opts
 */
export async function resolveWebhookInsertScope(env, opts) {
  let tenantId = resolveWebhookTenantId(env, opts.tenantId);
  let workspaceId =
    opts.workspaceId != null && String(opts.workspaceId).trim() !== ''
      ? String(opts.workspaceId).trim()
      : null;

  const provider = String(opts.provider || '').trim().toLowerCase();
  const workerNameFromPayload = extractWorkerNameFromWebhookPayload(opts.payload, opts.metadata);
  const repoFromPayload = extractGithubRepoFromWebhookPayload(opts.payload, opts.metadata);

  // Prefer unique agentsam_workspace.worker_name (CF Builds source.workerName) before github_repo.
  if (env?.DB && workerNameFromPayload) {
    const { lookupWorkspaceScopeByWorkerName } = await import('../../identity/workspace/worker-name.js');
    const byWorker = await lookupWorkspaceScopeByWorkerName(env.DB, workerNameFromPayload);
    if (byWorker) {
      tenantId = byWorker.tenantId;
      workspaceId = workspaceId || byWorker.workspaceId;
    }
  }

  // GitHub webhooks + CF Workers Builds + Cursor source.repository URL → workspace by github_repo.
  const metaRepo =
    opts.metadata?.repo_full_name != null
      ? normalizeGithubRepoFullName(opts.metadata.repo_full_name)
      : null;
  if (
    !tenantId &&
    env?.DB &&
    (provider === 'github' ||
      provider === 'cloudflare' ||
      provider === 'cursor' ||
      repoFromPayload ||
      metaRepo)
  ) {
    const repo =
      metaRepo ??
      repoFromPayload ??
      /** @type {any} */ (opts.payload)?.repository?.full_name ??
      null;
    const scope = await lookupWorkspaceScopeByGithubRepo(env.DB, repo);
    if (scope) {
      tenantId = scope.tenantId;
      workspaceId = workspaceId || scope.workspaceId;
      // After unique github_repo match, backfill worker_name from Builds payload when empty.
      if (workerNameFromPayload && workspaceId) {
        const { maybeBackfillWorkspaceWorkerName } = await import('../../identity/workspace/worker-name.js');
        await maybeBackfillWorkspaceWorkerName(env, {
          workspaceId,
          workerName: workerNameFromPayload,
        });
      }
    }
  }

  if (!tenantId) {
    const platform = await resolvePlatformWebhookScope(env, workspaceId);
    if (platform) {
      tenantId = platform.tenantId;
      workspaceId = workspaceId || platform.workspaceId;
    }
  }

  // Last resort: platform TENANT_ID / WORKSPACE_ID secrets without D1 workspace row.
  if (!tenantId) {
    try {
      const { resolveCronTenantId, resolveCronWorkspaceId } = await import('../../jobs/cron-tenant.js');
      tenantId = (await resolveCronTenantId(env)) || '';
      if (!workspaceId) {
        workspaceId = (await resolveCronWorkspaceId(env)) || '';
      }
    } catch {
      /* secrets not configured */
    }
  }

  return { tenantId, workspaceId };
}

/**
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {string} provider
 * @param {string} [endpointPath] e.g. /api/webhooks/github
 */
async function lookupRegistryEndpointId(db, provider, endpointPath) {
  const p = provider != null ? String(provider).trim() : '';
  if (!p) return null;
  try {
    if (endpointPath) {
      const path = String(endpointPath).trim();
      const legacy = path.replace('/api/webhooks/', '/api/hooks/');
      const row = await db
        .prepare(
          `SELECT id FROM ${REGISTRY_TABLE}
           WHERE is_active = 1
             AND (endpoint_url LIKE '%' || ? OR endpoint_url LIKE '%' || ?)
           ORDER BY rowid ASC LIMIT 1`,
        )
        .bind(path, legacy)
        .first();
      if (row?.id) return String(row.id);
    }
    const row = await db
      .prepare(
        `SELECT id FROM ${REGISTRY_TABLE}
         WHERE provider = ? AND is_active = 1
         ORDER BY rowid ASC LIMIT 1`,
      )
      .bind(p)
      .first();
    return row?.id != null ? String(row.id) : null;
  } catch {
    return null;
  }
}

/**
 * @param {any} env
 * @param {{
 *   id?: string,
 *   tenantId?: string | null,
 *   workspaceId?: string | null,
 *   provider: string,
 *   eventType: string,
 *   eventId?: string | null,
 *   payload?: unknown,
 *   metadata?: Record<string, unknown> | null,
 *   endpointId?: string | null,
 *   endpointPath?: string | null,
 *   status?: string,
 *   signatureValid?: boolean,
 * }} opts
 */
export async function insertAgentsamWebhookEvent(env, opts) {
  const db = env?.DB;
  if (!db) return { ok: false, reason: 'no_db' };

  const cols = await pragmaTableInfo(db, EVENTS_TABLE);
  if (!cols.size) return { ok: false, reason: 'table_missing' };

  const provider = opts.provider != null ? String(opts.provider).trim() : '';
  const eventType = opts.eventType != null ? String(opts.eventType).trim() : '';
  if (!provider || !eventType) return { ok: false, reason: 'missing_provider_or_event_type' };

  const id = opts.id != null ? String(opts.id).trim() : newWebhookEventId();
  const scope = await resolveWebhookInsertScope(env, opts);
  const tenantId = scope.tenantId;
  const workspaceId = scope.workspaceId;
  if (!tenantId) {
    console.warn('[webhook-events] insert skipped: missing tenant_id', provider, eventType);
    return { ok: false, reason: 'missing_tenant_id' };
  }
  const receivedUnix = Math.floor(Date.now() / 1000);

  let endpointId = opts.endpointId != null ? String(opts.endpointId).trim() : '';
  if (!endpointId) {
    endpointId =
      (await lookupRegistryEndpointId(db, provider, opts.endpointPath ?? null)) || '';
  }

  const eventId =
    opts.eventId != null && String(opts.eventId).trim()
      ? String(opts.eventId).trim().slice(0, 200)
      : null;
  const metadataJson = stringifyCompactWebhookMetadata(opts.payload, opts.metadata);

  try {
    await db
      .prepare(
        `INSERT INTO ${EVENTS_TABLE} (
           id, tenant_id, workspace_id, endpoint_id, provider, event_type, event_id,
           metadata_json, status, received_at_unix, signature_valid
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        tenantId,
        workspaceId,
        endpointId || null,
        provider,
        eventType.slice(0, 200),
        eventId,
        metadataJson,
        normalizeWebhookLedgerStatus(opts.status),
        receivedUnix,
        opts.signatureValid === false ? 0 : 1,
      )
      .run();
    return { ok: true, id, endpointId: endpointId || null };
  } catch (e) {
    const msg = String(e?.message || e);
    if (eventId && /UNIQUE/i.test(msg)) {
      try {
        const existing = await db
          .prepare(
            `SELECT id FROM ${EVENTS_TABLE} WHERE provider = ? AND event_id = ? LIMIT 1`,
          )
          .bind(provider, eventId)
          .first();
        if (existing?.id) {
          return { ok: true, id: String(existing.id), endpointId: endpointId || null, duplicate: true };
        }
      } catch {
        /* fall through */
      }
    }
    console.warn('[webhook-events] insert', provider, eventType, msg);
    return { ok: false, reason: msg, id };
  }
}

/**
 * @param {any} env
 * @param {string} eventId
 */
export async function markAgentsamWebhookEventProcessed(env, eventId) {
  const db = env?.DB;
  const id = eventId != null ? String(eventId).trim() : '';
  if (!db || !id) return;
  const unix = Math.floor(Date.now() / 1000);
  try {
    await db
      .prepare(
        `UPDATE ${EVENTS_TABLE} SET status = 'processed', processed_at_unix = ? WHERE id = ?`,
      )
      .bind(unix, id)
      .run();
  } catch (e) {
    console.warn('[webhook-events] mark processed', id, e?.message ?? e);
  }
}

/**
 * Durable failure after insert — Cursor already got 2xx when deferDispatch ran; this row is the watch surface
 * (no separate outbox; agentsam_webhook_events.status='failed' is the dead-letter).
 * @param {any} env
 * @param {string} eventId
 * @param {string} error
 */
export async function markAgentsamWebhookEventFailed(env, eventId, error) {
  const db = env?.DB;
  const id = eventId != null ? String(eventId).trim() : '';
  if (!db || !id) return;
  const msg = String(error || 'dispatch_failed').slice(0, 2000);
  const unix = Math.floor(Date.now() / 1000);
  try {
    await db
      .prepare(
        `UPDATE ${EVENTS_TABLE}
         SET status = 'failed', processing_error = ?, processed_at_unix = ?
         WHERE id = ?`,
      )
      .bind(msg, unix, id)
      .run();
  } catch (e) {
    console.warn('[webhook-events] mark failed', id, e?.message ?? e);
  }
}

/**
 * Soft skip (no workflow / event not allowed) — not success, not hard failure.
 * @param {any} env
 * @param {string} eventId
 * @param {string} [reason]
 */
export async function markAgentsamWebhookEventIgnored(env, eventId, reason) {
  const db = env?.DB;
  const id = eventId != null ? String(eventId).trim() : '';
  if (!db || !id) return;
  const msg = String(reason || 'ignored').slice(0, 2000);
  const unix = Math.floor(Date.now() / 1000);
  try {
    await db
      .prepare(
        `UPDATE ${EVENTS_TABLE}
         SET status = 'ignored', processing_error = ?, processed_at_unix = ?
         WHERE id = ?`,
      )
      .bind(msg, unix, id)
      .run();
  } catch (e) {
    console.warn('[webhook-events] mark ignored', id, e?.message ?? e);
  }
}

/**
 * @param {any} env
 * @param {string} eventId
 * @param {Record<string, unknown>} patch
 */
export async function patchAgentsamWebhookEventMetadata(env, eventId, patch) {
  const db = env?.DB;
  const id = eventId != null ? String(eventId).trim() : '';
  if (!db || !id || !patch || typeof patch !== 'object') return;
  try {
    const prev = await db
      .prepare(`SELECT metadata_json FROM ${EVENTS_TABLE} WHERE id = ? LIMIT 1`)
      .bind(id)
      .first();
    const next = mergeWebhookMetadataJson(prev?.metadata_json, patch);
    await db
      .prepare(`UPDATE ${EVENTS_TABLE} SET metadata_json = ? WHERE id = ?`)
      .bind(next, id)
      .run();
  } catch (e) {
    console.warn('[webhook-events] patch metadata', id, e?.message ?? e);
  }
}

/**
 * Insert audit row; optionally mark processed (default true).
 * @param {any} env
 * @param {any} [ctx]
 * @param {Parameters<typeof insertAgentsamWebhookEvent>[1] & { markProcessed?: boolean }} opts
 */
export async function recordAgentsamWebhookEvent(env, ctx, opts) {
  const run = async () => {
    const ins = await insertAgentsamWebhookEvent(env, opts);
    if (ins.ok && opts.markProcessed !== false) {
      await markAgentsamWebhookEventProcessed(env, ins.id);
    }
    return ins;
  };
  if (ctx?.waitUntil) {
    ctx.waitUntil(run().catch((e) => console.warn('[webhook-events] record', e?.message ?? e)));
    return { scheduled: true };
  }
  return run();
}
