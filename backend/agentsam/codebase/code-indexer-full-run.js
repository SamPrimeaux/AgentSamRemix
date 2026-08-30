/**
 * Code indexer — product full/incremental pipeline host (crawl → stages → verify).
 */
import { ensureSupabaseWorkspaceId } from '../../rag/index.js';
import {
  FULL_INDEX_PIPELINE,
  INCREMENTAL_INDEX_MODE,
  INCREMENTAL_REQUIRES_ACTIVATED_BASELINE,
  PRODUCT_SOURCE_TYPE_SQL_IN,
  buildCompareDeltaFromGithubFiles,
  classifyRepoPath,
  classifyRepoTree,
  extractActivatedRevisionSha,
  normalizeCodeIndexMode,
  normalizeFullGitSha,
  isFileSmokeCodeIndexSourceType,
} from './codebase-full-index.js';
import { findActivatedCodeIndexBaseline } from './deploy-code-index-queue.js';
import { loadRepoIgnorePolicy } from '../../../packages/shared/code-index/ignore-policy.js';
import { loadCodeIndexJobFiles } from './code-index-job-files.js';
import {
  FULL_FILES_PER_RUN,
  FULL_FILES_CAP,
  FULL_SYMBOLS_PER_RUN,
  FULL_SYMBOLS_CAP,
  MINUTE_STALE_RECLAIM_SECONDS,
  nowUnix,
  notifyCodeIndexPush,
  notifyCodeIndexJobTerminal,
  resolveTenantIdForWorkspace,
} from './code-indexer-shared.js';
import {
  resolveGithubTokenForJob,
  loadRepoSnapshot,
  loadRepoCompareSnapshot,
  recoverPurgedFileManifest,
} from './code-indexer-github.js';
import {
  loadJobColumns,
  patchJob,
  parseJsonObject,
  fullStageSummary,
  carryForwardPriorArtifacts,
  slimManifestForD1,
  slimSymbolSummaryForD1,
  serializeManifestForD1,
  isJobCancelled,
  patchCheckpoint,
  logFullIndexTerminal,
  hydrateCallGraphOntoManifest,
} from './code-indexer-job-state.js';
import { runParseChunksStage } from './code-indexer-parse.js';
import { runEmbedSymbolsStage } from './code-indexer-embed.js';
import {
  verifyAndActivateFullRun,
  finalizeCallsBackfillFullRun,
} from './code-indexer-verify.js';

export async function runFullCodeIndexJob(env, job, opts, cols) {
  if (String(job.status || '') === 'cancelled' || (await isJobCancelled(env, job.id))) {
    return {
      ok: true,
      cancelled: true,
      skipped: true,
      reason: 'job_cancelled',
      run_id: job.id,
      job_id: job.id,
      status: 'cancelled',
    };
  }

  // Single-flight claim: idle→running, or stale running (no heartbeat) treated as dead.
  const staleSec = Math.max(60, Number(MINUTE_STALE_RECLAIM_SECONDS) || 120);
  const claim = await env.DB.prepare(
    `UPDATE agentsam_code_index_job
        SET status = 'running', started_at = COALESCE(started_at, unixepoch()), updated_at = unixepoch()
      WHERE id = ?
        AND (
          status = 'idle'
          OR (status = 'running' AND updated_at < unixepoch() - ${staleSec})
        )
        AND NOT EXISTS (
          SELECT 1 FROM agentsam_code_index_job AS other
           WHERE other.workspace_id = agentsam_code_index_job.workspace_id
             AND COALESCE(other.repo_full_name, '') = COALESCE(agentsam_code_index_job.repo_full_name, '')
             AND COALESCE(other.source_type, '') IN ${PRODUCT_SOURCE_TYPE_SQL_IN}
             AND other.status = 'running'
             AND other.updated_at >= unixepoch() - ${staleSec}
             AND other.id != agentsam_code_index_job.id
        )`,
  )
    .bind(job.id)
    .run();
  if (!claim?.meta?.changes) {
    if (await isJobCancelled(env, job.id)) {
      return {
        ok: true,
        cancelled: true,
        skipped: true,
        reason: 'job_cancelled',
        run_id: job.id,
        job_id: job.id,
        status: 'cancelled',
      };
    }
    const blocker = await env.DB.prepare(
      `SELECT id FROM agentsam_code_index_job
        WHERE workspace_id = ?
          AND COALESCE(repo_full_name, '') = COALESCE(?, '')
          AND source_type IN ${PRODUCT_SOURCE_TYPE_SQL_IN}
          AND status = 'running'
          AND updated_at >= unixepoch() - ${staleSec}
          AND id != ?
        LIMIT 1`,
    )
      .bind(String(job.workspace_id || ''), String(job.repo_full_name || ''), job.id)
      .first()
      .catch(() => null);
    if (blocker?.id) {
      return {
        ok: true,
        skipped: true,
        reason: 'single_flight_blocked',
        run_id: job.id,
        other_run_id: String(blocker.id),
        status: job.status,
      };
    }
    return { ok: true, skipped: true, reason: 'job_not_idle', run_id: job.id, status: job.status };
  }

  // Tree-sitter runtime reads this for D1 WASM heartbeats (before Parser.init).
  try {
    if (env && typeof env === 'object') env.__codeIndexJobId = String(job.id);
  } catch {
    /* ignore */
  }

  const workspaceId = String(job.workspace_id || '').trim();
  let workspaceUuid = null;
  try {
    workspaceUuid = await ensureSupabaseWorkspaceId(env, workspaceId);
  } catch (e) {
    const message = String(e?.message || e || 'workspace_uuid_unresolved').slice(0, 500);
    const nowSec = nowUnix();
    await patchJob(
      env,
      job.id,
      {
        status: 'failed',
        last_error: message,
        symbol_summary: JSON.stringify({
          ...fullStageSummary(job),
          stage: 'failed',
          readiness: 'failed',
          failure: {
            at: new Date().toISOString(),
            error: message,
            workspace_id: workspaceId || null,
          },
        }),
        finished_at: nowSec,
        ...(cols.has('completed_at') ? { completed_at: nowSec } : {}),
      },
      cols,
    ).catch(() => null);
    await logFullIndexTerminal(env, {
      outcome: 'failed',
      jobId: job.id,
      workspaceId: workspaceId || 'unknown',
      repoFullName: job.repo_full_name || null,
      stage: 'failed',
      error: message,
      stack: e?.stack || null,
      context: { failure_point: 'workspace_uuid_resolve' },
    });
    return {
      ok: false,
      error: message,
      run_id: job.id,
      job_id: job.id,
      mode: 'full',
      workspace_id: workspaceId || null,
    };
  }
  if (!workspaceUuid) {
    const nowSec = nowUnix();
    await patchJob(
      env,
      job.id,
      {
        status: 'failed',
        last_error: 'workspace_uuid_unresolved',
        symbol_summary: JSON.stringify({
          ...fullStageSummary(job),
          stage: 'failed',
          readiness: 'failed',
          failure: {
            at: new Date().toISOString(),
            error: 'workspace_uuid_unresolved',
            workspace_id: workspaceId || null,
          },
        }),
        finished_at: nowSec,
        ...(cols.has('completed_at') ? { completed_at: nowSec } : {}),
      },
      cols,
    ).catch(() => null);
    await logFullIndexTerminal(env, {
      outcome: 'failed',
      jobId: job.id,
      workspaceId: workspaceId || 'unknown',
      repoFullName: job.repo_full_name || null,
      stage: 'failed',
      error: 'workspace_uuid_unresolved',
      context: { failure_point: 'workspace_uuid_missing' },
    });
    return {
      ok: false,
      error: 'workspace_uuid_unresolved',
      run_id: job.id,
      job_id: job.id,
      mode: 'full',
      workspace_id: workspaceId || null,
    };
  }
  const tenantId = await resolveTenantIdForWorkspace(env, workspaceId);
  const gh = await resolveGithubTokenForJob(env, job);
  const repoFullName = gh.repoFullName;
  let manifest = parseJsonObject(job.file_manifest, {});
  let summary = fullStageSummary(job);
  // Resume for verify/embed/recover only — parse batches claim pending rows directly from job_file.
  const stageEarly = String(summary.stage || 'parse_chunks');
  const tableBackedParse =
    stageEarly === 'parse_chunks' ||
    stageEarly === 'queued' ||
    stageEarly === 'crawl' ||
    (Number(job.file_count) > 0 &&
      !['verify', 'verify_failed', 'activate', 'embed_symbols'].includes(stageEarly));
  if (!tableBackedParse && (!Array.isArray(manifest.files) || !manifest.files.length)) {
    try {
      const fromTable = await loadCodeIndexJobFiles(env, job.id);
      if (fromTable.length) manifest.files = fromTable;
    } catch (e) {
      console.warn('[code-indexer] job_file_hydrate_failed', e?.message || e);
    }
  }
  // Verify only needs file list + counts. Skip R2 call-graph hydrate until activate
  // (hydrate inside verifyAndActivateFullRun) so soft-allow can checkpoint before OOM.
  if (stageEarly !== 'verify' && stageEarly !== 'verify_failed' && stageEarly !== 'activate') {
    manifest = await hydrateCallGraphOntoManifest(env, job.id, manifest);
  }
  // Promote py/go (and any newly structural paths) mid-run without Restart.
  // Skip when parse uses job_file batch claims (no in-memory manifest.files).
  if (Array.isArray(manifest.files) && manifest.files.length && !tableBackedParse) {
    const repoPolicy = await loadRepoIgnorePolicy(env?.DB, repoFullName);
    for (const f of manifest.files) {
      if (!f?.path) continue;
      const status = String(f.status || '').toLowerCase();
      if (
        status === 'indexed' ||
        status === 'failed' ||
        status === 'skipped_unchanged' ||
        status === 'parse_failed_chunks_only' ||
        f.parse_error ||
        f.structural_quality === 'parse_failed'
      ) {
        continue;
      }
      const next = classifyRepoPath(f.path, f.size_bytes, repoPolicy);
      if (
        next.classification === 'structural_and_chunks' &&
        (f.classification !== 'structural_and_chunks' ||
          f.parser_id !== next.parser_id ||
          f.language !== next.language)
      ) {
        f.classification = next.classification;
        f.language = next.language;
        f.parser_id = next.parser_id;
        f.structural_quality = next.structural_quality;
        f.reason = next.reason;
      }
    }
  }
  const branch = String(manifest.branch || '').trim() || undefined;
  const jobMode = normalizeCodeIndexMode(summary.mode || manifest.mode || 'full');

  try {
    const tableBackedManifest =
      String(manifest.files_table || '').trim() === 'agentsam_code_index_job_file' ||
      (Number(manifest.files_count) > 0 && Number(job.file_count) > 0);
    const needsManifestRecover =
      !tableBackedManifest &&
      (manifest.purged === 1 ||
        manifest.purged === true ||
        manifest.purged_recover === 1 ||
        manifest.purged_recover === true ||
        !Array.isArray(manifest.files) ||
        !manifest.files.length);
    if (needsManifestRecover && (manifest.revision_sha || Number(job.indexed_file_count) > 0)) {
      console.warn('[code-indexer] recovering_purged_manifest', {
        jobId: job.id,
        indexed_file_count: Number(job.indexed_file_count) || 0,
        had_revision: Boolean(manifest.revision_sha),
      });
      manifest = await recoverPurgedFileManifest(env, job, gh, manifest, jobMode);
      const priorStage = String(summary.stage || '');
      summary = {
        ...summary,
        stage:
          priorStage && priorStage !== 'failed' && priorStage !== 'cancelled'
            ? priorStage
            : 'parse_chunks',
        mode: jobMode,
        revision_sha: manifest.revision_sha,
        stages: {
          ...(summary.stages && typeof summary.stages === 'object' ? summary.stages : {}),
          recover_manifest: {
            at: new Date().toISOString(),
            ok: true,
            revision_sha: manifest.revision_sha,
            files: Array.isArray(manifest.files) ? manifest.files.length : 0,
            indexed_file_count: Number(job.indexed_file_count) || 0,
          },
        },
      };
      await patchJob(
        env,
        job.id,
        {
          file_count: Array.isArray(manifest.files) ? manifest.files.length : Number(job.file_count) || 0,
          file_manifest: await serializeManifestForD1(env, job.id, manifest, {
            inventoryStamp: true,
          }),
          symbol_summary: JSON.stringify(slimSymbolSummaryForD1(summary)),
          last_error: null,
          revision_sha: normalizeFullGitSha(manifest.revision_sha),
          base_sha: normalizeFullGitSha(manifest.base_sha),
        },
        cols,
      );
    }

    if (!manifest.revision_sha) {
      let snapshot;
      let baselineJobId = manifest.baseline_job_id ? String(manifest.baseline_job_id) : null;
      let baseSha = manifest.base_sha ? String(manifest.base_sha).toLowerCase() : null;
      const repoPolicy = await loadRepoIgnorePolicy(env?.DB, repoFullName);

      if (jobMode === INCREMENTAL_INDEX_MODE) {
        if (!baseSha || !/^[a-f0-9]{40}$/.test(baseSha)) {
          const baseline = await findActivatedCodeIndexBaseline(env, workspaceId, repoFullName);
          if (!baseline?.revision_sha) {
            throw new Error(INCREMENTAL_REQUIRES_ACTIVATED_BASELINE);
          }
          baseSha = baseline.revision_sha;
          baselineJobId = baseline.job_id;
        }
        snapshot = await loadRepoCompareSnapshot(gh.token, repoFullName, baseSha, branch, { repoPolicy });
      } else {
        snapshot = await loadRepoSnapshot(gh.token, repoFullName, branch, { repoPolicy });
      }

      const processable = (snapshot.files || []).filter(
        (file) =>
          file.classification === 'structural_and_chunks' || file.classification === 'chunks_only',
      );
      const removedPaths = Array.isArray(snapshot.removed_paths)
        ? snapshot.removed_paths.map((p) => String(p))
        : [];

      // Incremental may be a pure no-op (identical HEAD) or deletes-only — do not fail loud
      // the way full-tree crawl does when processable is empty.
      if (jobMode !== INCREMENTAL_INDEX_MODE && !processable.length) {
        throw new Error('crawl_found_no_indexable_files');
      }

      let carry = null;
      if (jobMode === INCREMENTAL_INDEX_MODE) {
        if (!baselineJobId) {
          const baseline = await findActivatedCodeIndexBaseline(env, workspaceId, repoFullName);
          baselineJobId = baseline?.job_id || null;
        }
        if (!baselineJobId) throw new Error(INCREMENTAL_REQUIRES_ACTIVATED_BASELINE);
        const baselineCov = await env.DB.prepare(
          `SELECT COUNT(*) AS nodes, COUNT(DISTINCT file_path) AS files
             FROM codebase_ast_nodes
            WHERE workspace_id = ? AND repo_full_name = ? AND index_job_id = ?`,
        )
          .bind(workspaceId, repoFullName, baselineJobId)
          .first()
          .catch(() => null);
        const baselineFiles = Number(baselineCov?.files) || 0;
        const baselineNodes = Number(baselineCov?.nodes) || 0;
        const excludePaths = new Set([
          ...removedPaths,
          ...processable.map((f) => String(f.path)),
        ]);
        carry = await carryForwardPriorArtifacts(env, {
          workspaceId,
          workspaceUuid,
          repoFullName,
          priorJobId: baselineJobId,
          newJobId: job.id,
          excludePaths,
        });
        const afterCov = await env.DB.prepare(
          `SELECT COUNT(*) AS nodes, COUNT(DISTINCT file_path) AS files
             FROM codebase_ast_nodes
            WHERE workspace_id = ? AND repo_full_name = ? AND index_job_id = ?`,
        )
          .bind(workspaceId, repoFullName, job.id)
          .first()
          .catch(() => null);
        carry = {
          ...carry,
          baseline_files: baselineFiles,
          baseline_nodes: baselineNodes,
          after_carry_files: Number(afterCov?.files) || 0,
          after_carry_nodes: Number(afterCov?.nodes) || 0,
        };
        // Fail loud: baseline had real coverage, delta is small, carry moved nothing.
        // Activate must not proceed to job-id prune with an empty new snapshot.
        const deltaTouch = processable.length + removedPaths.length;
        const carriedNodes = Number(carry.d1_nodes_carried) || 0;
        if (baselineFiles >= 50 && carriedNodes === 0 && deltaTouch < baselineFiles * 0.5) {
          throw new Error(
            `incremental_carry_coverage_collapse:baseline_files=${baselineFiles}:baseline_nodes=${baselineNodes}:carried_nodes=0:processable=${processable.length}:removed=${removedPaths.length}`,
          );
        }
      }

      manifest = {
        run_id: job.id,
        pipeline: FULL_INDEX_PIPELINE,
        mode: jobMode,
        repo_full_name: repoFullName,
        // Legacy manifest key — same GitHub owner/name, not a local path.
        repo: repoFullName,
        branch: snapshot.branch || branch || null,
        revision_sha: snapshot.revision_sha,
        head_sha: snapshot.head_sha || snapshot.revision_sha,
        base_sha: snapshot.base_sha || baseSha || null,
        baseline_job_id: baselineJobId,
        discovery: snapshot.discovery || (jobMode === INCREMENTAL_INDEX_MODE ? 'compare' : 'tree'),
        classification_complete: true,
        totals: snapshot.totals,
        languages: snapshot.languages,
        files: processable,
        removed_paths: removedPaths,
        changed_count:
          snapshot.changed_count != null
            ? Number(snapshot.changed_count)
            : processable.length + removedPaths.length,
        excluded_sample:
          jobMode === INCREMENTAL_INDEX_MODE
            ? []
            : (snapshot.files || [])
                .filter(
                  (file) =>
                    file.classification === 'ignored' || file.classification === 'metadata_only',
                )
                .slice(0, 40),
      };
      const now = new Date().toISOString();
      summary = {
        ...summary,
        mode: jobMode,
        stage: 'parse_chunks',
        revision_sha: snapshot.revision_sha,
        base_sha: manifest.base_sha,
        baseline_job_id: baselineJobId,
        stages: {
          ...summary.stages,
          crawl: {
            at: now,
            ok: true,
            discovery: manifest.discovery,
            revision_sha: snapshot.revision_sha,
            head_sha: manifest.head_sha,
            base_sha: manifest.base_sha,
            authorized_blobs: snapshot.totals?.authorized_blobs ?? processable.length,
            processable_files: processable.length,
            changed_count: manifest.changed_count,
            removed_count: removedPaths.length,
            removed_paths: removedPaths,
            classifications: snapshot.totals,
            compare_status: snapshot.compare_status || null,
            carry_forward: carry,
          },
          classify: {
            at: now,
            ok: true,
            terminal: true,
            languages: snapshot.languages || {},
          },
        },
      };
      try {
        await patchJob(
          env,
          job.id,
          {
            repo_full_name: repoFullName,
            file_count: processable.length,
            indexed_file_count: 0,
            failed_file_count: 0,
            chunk_count: 0,
            symbol_count: 0,
            progress_percent: 1,
            total_size_bytes: processable.reduce((sum, file) => sum + (Number(file.size_bytes) || 0), 0),
            languages: JSON.stringify(snapshot.languages || {}),
            file_manifest: await serializeManifestForD1(env, job.id, manifest, {
              inventoryStamp: true,
            }),
            symbol_summary: JSON.stringify(slimSymbolSummaryForD1(summary)),
            // Real columns (migration 1164) — tip/base for incremental without JSON.parse.
            revision_sha: normalizeFullGitSha(snapshot.revision_sha),
            base_sha: normalizeFullGitSha(manifest.base_sha),
            ast_node_count: Number(carry?.after_carry_nodes) || 0,
            ast_file_count: Number(carry?.after_carry_files) || 0,
            ast_last_indexed_at: Math.floor(Date.now() / 1000),
          },
          cols,
        );
      } catch (writeErr) {
        const manifestBytes = JSON.stringify(slimManifestForD1(manifest)).length;
        const wrapped = new Error(
          `manifest_build_write_failed:${String(writeErr?.message || writeErr).slice(0, 200)}:manifest_bytes=${manifestBytes}:files=${processable.length}`,
        );
        wrapped.stack = writeErr?.stack || wrapped.stack;
        throw wrapped;
      }
      job.indexed_file_count = 0;
      job.chunk_count = 0;
      job.failed_file_count = 0;
    }

    const stage = String(summary.stage || 'parse_chunks');
    if (stage === 'queued' || stage === 'crawl' || stage === 'parse_chunks') {
      return runParseChunksStage(env, {
        job,
        workspaceUuid,
        workspaceId,
        tenantId,
        repoFullName,
        manifest,
        summary,
        cols,
        opts,
        jobMode,
        gh,
      });
    }

    if (stage === 'embed_symbols') {
      return runEmbedSymbolsStage(env, {
        job,
        workspaceUuid,
        workspaceId,
        tenantId,
        repoFullName,
        manifest,
        summary,
        cols,
        opts,
        jobMode,
      });
    }

    if (stage === 'verify' || stage === 'verify_failed' || stage === 'activate') {
      // File smoke: real parse/embed writes only — never activate/orphan-prune.
      if (isFileSmokeCodeIndexSourceType(job.source_type) || manifest?.smoke_file === true) {
        const finishSec = nowUnix();
        const smokeSummary = {
          ...summary,
          stage: 'smoke_complete',
          readiness: 'smoke_ok',
          stages: {
            ...summary.stages,
            smoke_complete: {
              at: new Date(finishSec * 1000).toISOString(),
              ok: true,
              path: manifest?.files?.[0]?.path || job.source_path || null,
              skipped_activate: true,
            },
          },
        };
        await patchJob(
          env,
          job.id,
          {
            status: 'completed',
            progress_percent: 100,
            last_error: null,
            completed_at: finishSec,
            finished_at: finishSec,
            last_sync_at: finishSec,
            is_active: 0,
            symbol_summary: JSON.stringify(slimSymbolSummaryForD1(smokeSummary)),
          },
          cols,
        );
        return {
          ok: true,
          complete: true,
          smoke_file: true,
          run_id: job.id,
          job_id: job.id,
          pipeline: FULL_INDEX_PIPELINE,
          mode: jobMode,
          stage: 'smoke_complete',
          status: 'completed',
          indexed_file_count: Number(job.indexed_file_count) || 0,
          chunk_count: Number(job.chunk_count) || 0,
          symbol_count: Number(job.symbol_count) || 0,
        };
      }
      // verify_failed → Continue remap; activate = verify already checkpointed, finish edges.
      return verifyAndActivateFullRun(env, job, workspaceUuid, manifest, summary, cols);
    }

    if (stage === 'calls_backfill') {
      return finalizeCallsBackfillFullRun(env, job, summary, cols);
    }

    if (stage === 'active') {
      // Heal stuck "completed" runs that never finished Level 2.
      const bf = summary?.stages?.calls_backfill;
      const callsPending =
        bf &&
        bf.ok !== true &&
        (Number(bf.total_shards) > 0 || bf.queued === true || Number(bf.shard_index) >= 0);
      if (callsPending) {
        return finalizeCallsBackfillFullRun(
          env,
          job,
          { ...summary, stage: 'calls_backfill', readiness: 'imports_ready' },
          cols,
        );
      }
      // Heal: summary already active+calls_ok but row stuck running/idle after reclaim.
      const rowStatus = String(job.status || '').toLowerCase();
      if (rowStatus !== 'completed' && rowStatus !== 'failed' && rowStatus !== 'cancelled') {
        const finishSec = nowUnix();
        await patchJob(
          env,
          job.id,
          {
            status: 'completed',
            progress_percent: 100,
            last_error: null,
            completed_at: finishSec,
            finished_at: finishSec,
            last_sync_at: finishSec,
          },
          cols,
        ).catch((e) => console.warn('[code-indexer] active_heal_completed_failed', e?.message || e));
      }
      return {
        ok: true,
        complete: true,
        run_id: job.id,
        job_id: job.id,
        pipeline: FULL_INDEX_PIPELINE,
        mode: jobMode,
        stage: 'active',
        status: 'completed',
        readiness: summary.readiness || 'ready_with_degradation',
        revision_sha: manifest.revision_sha,
      };
    }
    throw new Error(`unknown_full_index_stage:${stage}`);
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    console.warn('[code-indexer] runFullCodeIndexJob_failed', {
      jobId: job.id,
      stage: summary?.stage || null,
      error: message,
    });
    const failedSummary = slimSymbolSummaryForD1({
      ...summary,
      stage: 'failed',
      readiness: 'failed',
      failure: { at: new Date().toISOString(), error: message },
    });
    // Best-effort slim manifest so a fat in-memory blob does not also kill the failed patch.
    let failedManifestPatch = {};
    try {
      failedManifestPatch = {
        file_manifest: await serializeManifestForD1(env, job.id, manifest, {
          persistFilesOnly: Array.isArray(manifest.files)
            ? manifest.files.filter((f) => f?.status != null && String(f.status).trim())
            : [],
          inventoryStamp: false,
        }),
      };
    } catch {
      try {
        failedManifestPatch = {
          file_manifest: JSON.stringify(slimManifestForD1(manifest)),
        };
      } catch {
        failedManifestPatch = { file_manifest: JSON.stringify({ purged: 1, reason: 'manifest_serialize_failed' }) };
      }
    }
    await patchJob(
      env,
      job.id,
      {
        status: 'failed',
        last_error: message,
        symbol_summary: JSON.stringify(failedSummary),
        finished_at: nowUnix(),
        ...failedManifestPatch,
      },
      cols,
    ).catch((e) => {
      console.warn('[code-indexer] failed_status_patch_error', e?.message || e);
    });
    // message now carries a specific prefix (manifest_build_write_failed / parse_chunks_checkpoint_write_failed
    // / etc.) from wrapped inner catches where present, instead of a bare D1 error string.
    const failurePoint = message.includes(':')
      ? message.slice(0, message.indexOf(':'))
      : 'runFullCodeIndexJob_catch';
    await logFullIndexTerminal(env, {
      outcome: 'failed',
      jobId: job.id,
      workspaceId: String(job.workspace_id || '').trim() || 'unknown',
      repoFullName: job.repo_full_name || null,
      revisionSha: manifest?.revision_sha || null,
      stage: 'failed',
      error: message,
      stack: error?.stack || null,
      context: { failure_point: failurePoint },
    });
    // patchJob(status=failed) already awaits notifyCodeIndexJobTerminal with last_error.
    return {
      ok: false,
      error: message,
      run_id: job.id,
      job_id: job.id,
      mode: normalizeCodeIndexMode(summary?.mode || manifest?.mode || 'full'),
    };
  }
}


