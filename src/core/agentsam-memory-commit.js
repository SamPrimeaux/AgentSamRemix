/**
 * Canonical memory commit — D1 SSOT + same-batch outbox.
 * Projections (PG / pgvector / Vectorize) are eager-best-effort, then outbox retry.
 */
import {
  DESIRED_PROJECTIONS,
  draftMemoryCommit,
  buildProjectionKey,
  sha256Hex,
} from './agentsam-memory-contract.js';
import { processMemoryOutboxJob } from './agentsam-memory-outbox.js';
import { resolveMemoryAuth, resolveMemorySemanticScope } from './agentsam-memory-scope.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

function textContent(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

function newId(prefix) {
  const hex = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return `${prefix}_${hex}`;
}

export { resolveMemoryAuth };

/**
 * Classify relationship vs existing active row.
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {object} draft
 */
async function classifyRelationship(db, draft) {
  const row = await db
    .prepare(
      `SELECT id, memory_id, revision, content_hash, status, value AS content, title
         FROM agentsam_memory
        WHERE tenant_id = ? AND user_id = ? AND key = ? AND status = 'active'
        LIMIT 1`,
    )
    .bind(draft.tenant_id, draft.user_id, draft.memory_key)
    .first();

  if (!row) return { relationship: 'new', prior: null };
  if (trim(row.content_hash) && trim(row.content_hash) === draft.content_hash) {
    return { relationship: 'duplicate', prior: row };
  }
  // Near-identical content without hash match
  if (trim(row.content) === draft.content) {
    return { relationship: 'duplicate', prior: row };
  }
  if (draft.supersedes && (draft.supersedes === row.key || draft.supersedes === row.memory_id)) {
    return { relationship: 'supersession', prior: row };
  }
  // Same key, different content → revision (not silent overwrite conflict)
  return { relationship: 'revision', prior: row };
}

/**
 * @param {Record<string, unknown>} env
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {Record<string, unknown>} workspace
 * @param {Record<string, unknown>} args
 * @param {{ eager?: boolean, tool_key?: string }} [opts]
 */
export async function executeAgentsamMemoryCommit(env, db, workspace, args = {}, opts = {}) {
  if (!db) {
    return textContent({ ok: false, error: 'db_not_configured' });
  }

  const auth = await resolveMemoryAuth(env, workspace);
  if (!auth.tenant_id || !auth.user_id) {
    return textContent({ ok: false, error: 'auth_scope_required' });
  }

  const scope = await resolveMemorySemanticScope({
    auth: { ...auth, authorized_workspaces: workspace?.authorized_workspaces },
    args,
    env,
  });
  if (!scope.ok) {
    return textContent({
      ok: false,
      error: 'scope_resolution_failed',
      errors: scope.errors,
      transport_workspace_key: scope.transport_workspace_key,
      source_client: scope.source_client,
      active_project_workspace_key: scope.active_project_workspace_key,
    });
  }

  // Semantic project workspace for the row — never MCP transport silo.
  const authForDraft = {
    ...auth,
    workspace_id: scope.active_project_workspace_key,
  };
  const scopedArgs = {
    ...args,
    workspace_id: scope.active_project_workspace_key,
    scope_type: args.scope_type || scope.scope_type,
    scope_id: args.scope_id || scope.scope_id,
    source_client: scope.source_client,
    transport_workspace_key: scope.transport_workspace_key,
    source_type: trim(args.source_type) || scope.source_client || 'structured',
    source_ref:
      trim(args.source_ref) ||
      JSON.stringify({
        transport_workspace_key: scope.transport_workspace_key,
        source_client: scope.source_client,
        authenticated_actor_id: scope.authenticated_actor_id,
        active_project_workspace_key: scope.active_project_workspace_key,
        supabase_workspace_id: scope.supabase_workspace_id,
      }),
  };

  const drafted = await draftMemoryCommit(scopedArgs, authForDraft);
  const dryRun = args.dry_run === true;
  const eager = opts.eager !== undefined ? opts.eager !== false : args.eager !== false;

  if (!drafted.ok) {
    return textContent({
      ok: false,
      error: 'validation_failed',
      errors: drafted.errors,
      warnings: drafted.warnings,
      draft: drafted.draft,
      scope,
    });
  }

  const draft = {
    ...drafted.draft,
    transport_workspace_key: scope.transport_workspace_key,
    source_client: scope.source_client,
    supabase_workspace_id: scope.supabase_workspace_id,
  };
  const classified = await classifyRelationship(db, draft);

  // Idempotency: exact key hit
  if (trim(draft.idempotency_key)) {
    const idem = await db
      .prepare(
        `SELECT id, memory_id, revision, content_hash, status, projection_status, key
           FROM agentsam_memory
          WHERE tenant_id = ? AND user_id = ? AND idempotency_key = ?
          LIMIT 1`,
      )
      .bind(draft.tenant_id, draft.user_id, draft.idempotency_key)
      .first();
    if (idem) {
      const payload = {
        ok: true,
        status: 'idempotent_replay',
        relationship: 'duplicate',
        memory_id: idem.memory_id,
        revision: idem.revision,
        memory_key: idem.key,
        content_hash: idem.content_hash,
        projection_status: idem.projection_status,
        semantic_ready: idem.projection_status === 'ready',
        dry_run: dryRun,
      };
      if (dryRun) {
        return textContent({
          ...payload,
          draft,
          validation: { errors: [], warnings: drafted.warnings },
          proposed_relationship: 'duplicate',
        });
      }
      return textContent(payload);
    }
  }

  if (dryRun) {
    return textContent({
      ok: true,
      dry_run: true,
      draft,
      validation: { errors: [], warnings: drafted.warnings },
      deduplication: classified,
      proposed_relationship: classified.relationship,
      writes: false,
    });
  }

  if (classified.relationship === 'duplicate' && classified.prior) {
    return textContent({
      ok: true,
      status: 'duplicate',
      relationship: 'duplicate',
      memory_id: classified.prior.memory_id,
      revision: classified.prior.revision,
      memory_key: draft.memory_key,
      content_hash: draft.content_hash,
      projection_status: null,
      semantic_ready: false,
      message: 'Identical active memory already exists; no write.',
    });
  }

  // Conflicts: same key with materially different content without supersedes intent is still a revision
  // (user asked not to silently overwrite — we create a new revision and supersede prior).
  const now = Math.floor(Date.now() / 1000);
  const prior = classified.prior;
  const memoryId = prior ? trim(prior.memory_id) || trim(prior.id) : newId('mem');
  const revision = prior ? Number(prior.revision || 1) + 1 : 1;
  const rowId = newId('memr');
  const outboxId = newId('mob');
  const syncKey = `${draft.tenant_id}:${draft.user_id}:${draft.memory_key}`;
  const expiresAt =
    draft.expires_at == null || draft.expires_at === ''
      ? null
      : Number.isFinite(Number(draft.expires_at))
        ? Number(draft.expires_at)
        : Math.floor(Date.parse(String(draft.expires_at)) / 1000) || null;

  const stmts = [];

  if (prior) {
    stmts.push(
      db
        .prepare(
          `UPDATE agentsam_memory
              SET status = 'superseded',
                  superseded_by_id = ?,
                  updated_at = ?
            WHERE id = ?`,
        )
        .bind(rowId, now, prior.id),
    );
  }

  stmts.push(
    db
      .prepare(
        `INSERT INTO agentsam_memory (
          id, memory_id, tenant_id, user_id, workspace_id, scope_type, scope_id,
          memory_type, key, value, title, summary, source, source_type, source_ref,
          confidence, importance, is_pinned, is_archived, sync_key, tags,
          created_at, updated_at, revision, status, content_hash, sensitivity,
          value_json, supersedes_id, projection_status, projection_version,
          projection_attempts, idempotency_key, expires_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?,
          1.0, ?, ?, 0, ?, ?,
          ?, ?, ?, 'active', ?, ?,
          ?, ?, 'pending', 0,
          0, ?, ?
        )`,
      )
      .bind(
        rowId,
        memoryId,
        draft.tenant_id,
        draft.user_id,
        draft.workspace_id,
        draft.scope_type,
        draft.scope_id,
        draft.memory_type,
        draft.memory_key,
        draft.content,
        draft.title,
        draft.summary,
        draft.source,
        draft.source_type,
        draft.source_ref,
        draft.importance,
        draft.is_pinned ? 1 : 0,
        syncKey,
        JSON.stringify(draft.tags),
        now,
        now,
        revision,
        draft.content_hash,
        draft.sensitivity,
        draft.value_json ? JSON.stringify(draft.value_json) : null,
        prior ? prior.id : draft.supersedes || null,
        draft.idempotency_key,
        expiresAt,
      ),
  );

  stmts.push(
    db
      .prepare(
        `INSERT INTO agentsam_memory_outbox (
          id, memory_id, revision, content_hash, operation, desired_projections_json,
          status, attempts, next_attempt_at, receipts_json,
          tenant_id, user_id, workspace_id, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, 'upsert', ?,
          'pending', 0, ?, '{}',
          ?, ?, ?, ?, ?
        )`,
      )
      .bind(
        outboxId,
        memoryId,
        revision,
        draft.content_hash,
        JSON.stringify(DESIRED_PROJECTIONS),
        now,
        draft.tenant_id,
        draft.user_id,
        draft.workspace_id,
        now,
        now,
      ),
  );

  await db.batch(stmts);

  if (draft.workspace_id) {
    try {
      const { bumpKnowledgeGeneration } = await import('./knowledge-protocol-bridge.js');
      await bumpKnowledgeGeneration(env, {
        tenant_id: draft.tenant_id,
        workspace_id: draft.workspace_id,
      });
    } catch (e) {
      console.warn('[knowledge_generation] commit_bump', e?.message ?? e);
    }
  }

  let projection = {
    attempted: false,
    status: 'pending',
    semantic_ready: false,
    receipts: {},
    failed: [],
  };

  if (eager) {
    projection.attempted = true;
    try {
      const result = await processMemoryOutboxJob(env, db, outboxId, {
        retrieval_text: draft.retrieval_text,
        row: {
          id: rowId,
          memory_id: memoryId,
          revision,
          key: draft.memory_key,
          memory_type: draft.memory_type,
          title: draft.title,
          summary: draft.summary,
          value: draft.content,
          tags: draft.tags,
          tenant_id: draft.tenant_id,
          user_id: draft.user_id,
          workspace_id: draft.workspace_id,
          scope_type: draft.scope_type,
          scope_id: draft.scope_id,
          content_hash: draft.content_hash,
          sensitivity: draft.sensitivity,
          status: 'active',
          source: draft.source,
          source_type: draft.source_type,
        },
      });
      projection = { ...projection, ...result };
    } catch (e) {
      projection.status = 'partial';
      projection.failed = ['eager_exception'];
      projection.error = e?.message || String(e);
      await db
        .prepare(
          `UPDATE agentsam_memory_outbox
              SET status = 'partial', last_error = ?, attempts = attempts + 1, updated_at = ?
            WHERE id = ?`,
        )
        .bind(projection.error.slice(0, 500), now, outboxId)
        .run();
      await db
        .prepare(
          `UPDATE agentsam_memory
              SET projection_status = 'partial',
                  last_projection_error = ?,
                  projection_attempts = projection_attempts + 1,
                  updated_at = ?
            WHERE id = ?`,
        )
        .bind(projection.error.slice(0, 500), now, rowId)
        .run();
    }
  }

  return textContent({
    ok: true,
    status: projection.semantic_ready ? 'committed_ready' : eager ? 'accepted_partial' : 'accepted',
    relationship: classified.relationship,
    memory_id: memoryId,
    revision,
    row_id: rowId,
    memory_key: draft.memory_key,
    content_hash: draft.content_hash,
    outbox_id: outboxId,
    projection_status: projection.status,
    semantic_ready: projection.semantic_ready === true,
    receipts: projection.receipts || {},
    failed_projections: projection.failed || [],
    eager,
    warnings: drafted.warnings,
    transport_workspace_key: draft.transport_workspace_key,
    source_client: draft.source_client,
    active_project_workspace_key: draft.workspace_id,
    supabase_workspace_id: draft.supabase_workspace_id,
  });
}

/**
 * save → commit with eager:false (still enqueues outbox).
 */
export async function executeAgentsamMemorySaveViaCommit(env, db, workspace, args = {}) {
  return executeAgentsamMemoryCommit(env, db, workspace, args, { eager: false, tool_key: 'agentsam_memory_save' });
}

export { draftMemoryCommit, buildProjectionKey, sha256Hex };
