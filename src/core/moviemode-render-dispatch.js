/**
 * MovieMode Remotion export — one dock host, no silent hop.
 *
 * local  → Mac localpty (user_hosted_tunnel)
 * remote → GCP iam-tunnel (platform_vm / PTY_SERVICE)
 * sandbox → MY_CONTAINER POST /render only
 */
import { tryMoviemodeRenderOnContainer } from '../../backend/agentsam/sandbox/my-container.js';
import {
  execOnPtyHost,
  resolveTerminalCwd,
  resolveMoviemodeRepoRootForSession,
  validateMoviemodeRepoOnPty,
} from '../../backend/agentsam/terminal/pty-workspace-paths.js';
import { resolveMoviemodeKv } from './moviemode-kv.js';

function jobKvKey(jobId) {
  return `moviemode_job_${String(jobId || '')}`;
}

async function writeJob(env, jobId, row) {
  const kv = resolveMoviemodeKv(env);
  if (kv) {
    await kv.put(jobKvKey(jobId), JSON.stringify(row), { expirationTtl: 3600 });
  }
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, lane: 'local'|'remote'|'sandbox' } | { ok: false, code: string, raw?: string }}
 */
export function parseMoviemodeExportExecLane(body) {
  const lane = String(body?.exec_lane || '').trim().toLowerCase();
  return lane === 'local' || lane === 'remote' || lane === 'sandbox'
    ? { ok: true, lane }
    : { ok: false, code: lane ? 'exec_lane_invalid' : 'exec_lane_required', ...(lane ? { raw: lane } : {}) };
}

/**
 * @param {'local'|'remote'|'sandbox'|string|null|undefined} execLane
 * @returns {{ ok: true, host: 'pty'|'container', targetType: string, renderLane: string } | { ok: false, error: string }}
 */
export function moviemodeRenderPlan(execLane) {
  const lane = String(execLane || '')
    .trim()
    .toLowerCase();
  if (lane === 'sandbox') {
    return { ok: true, host: 'container', targetType: 'sandbox', renderLane: 'sandbox' };
  }
  if (lane === 'local') {
    return { ok: true, host: 'pty', targetType: 'user_hosted_tunnel', renderLane: 'local' };
  }
  if (lane === 'remote') {
    return { ok: true, host: 'pty', targetType: 'platform_vm', renderLane: 'remote' };
  }
  return { ok: false, error: lane ? 'exec_lane_invalid' : 'exec_lane_required' };
}

async function writeMoviemodeJobError(env, jobId, job, errPayload) {
  const errorCode = String(errPayload.errorCode || errPayload.error || 'export_failed');
  const row = {
    ...job,
    status: 'error',
    progressPercent: 0,
    errorMessage: String(errPayload.message || errorCode || 'export failed').slice(0, 500),
    errorCode,
    expectedPath: errPayload.expectedPath || null,
    workspaceRoot: errPayload.workspaceRoot || job.workspaceRoot || null,
    installCommand: errPayload.installCommand || null,
    uiHint: errPayload.uiHint || null,
    renderLane: job.renderLane || null,
  };
  await writeJob(env, jobId, row);
  await markRenderJobFailed(env, job, errorCode, row.errorMessage);
}

async function markRenderJobFailed(env, job, errorCode, message) {
  const renderJobId = job?.renderJobId != null ? String(job.renderJobId).trim() : '';
  const workspaceId = job?.workspaceId != null ? String(job.workspaceId).trim() : '';
  if (!env?.DB || !renderJobId || !workspaceId) return;
  await env.DB.prepare(
    `UPDATE moviemode_render_jobs SET
       status = 'failed',
       error_message = ?,
       output_json = ?,
       completed_at = datetime('now'),
       updated_at = datetime('now')
     WHERE id = ? AND workspace_id = ?`,
  )
    .bind(
      String(message || errorCode).slice(0, 500),
      JSON.stringify({ error_code: errorCode, exec_lane: job.execLane || null }),
      renderJobId,
      workspaceId,
    )
    .run()
    .catch(() => {});
}

/**
 * @param {any} env
 * @param {string} jobId
 * @param {Record<string, unknown>} job
 * @param {{
 *   tryContainer?: typeof tryMoviemodeRenderOnContainer,
 *   execOnPtyHost?: typeof execOnPtyHost,
 *   getConnection?: Function,
 * }} [deps]
 */
export async function startRemotionRender(env, jobId, job, deps = {}) {
  const plan = moviemodeRenderPlan(job.execLane);
  if (!plan.ok) {
    await writeMoviemodeJobError(env, jobId, job, {
      errorCode: plan.error,
      message:
        plan.error === 'exec_lane_required'
          ? 'Pick Local, VM, or Sandbox in the terminal dock before export'
          : `Invalid exec_lane: ${String(job.execLane || '')}`,
    });
    return;
  }

  job.renderLane = plan.renderLane;
  await writeJob(env, jobId, { ...job, status: 'queued', renderLane: plan.renderLane });

  if (plan.host === 'container') {
    const tryContainer = deps.tryContainer || tryMoviemodeRenderOnContainer;
    const containerTry = await tryContainer(env, jobId, job);
    if (containerTry.handled) {
      await writeJob(env, jobId, {
        ...job,
        status: containerTry.result?.status === 'complete' ? 'complete' : 'rendering',
        progressPercent: containerTry.result?.progressPercent ?? 0,
        renderLane: 'sandbox',
      });
      return;
    }
    await writeMoviemodeJobError(env, jobId, job, {
      errorCode: 'container_render_unavailable',
      message: String(
        containerTry.reason || containerTry.error || 'MY_CONTAINER /render unavailable',
      ).slice(0, 400),
    });
    return;
  }

  return startRemotionRenderOnPty(env, jobId, job, plan, deps);
}

async function startRemotionRenderOnPty(env, jobId, job, plan, deps = {}) {
  const uid = String(job.userId || '').trim();
  if (!uid) {
    await writeMoviemodeJobError(env, jobId, job, {
      errorCode: 'workspace_context_missing',
      message: 'user_id required to resolve export host',
    });
    return;
  }

  const getConnection = deps.getConnection;
  const sel = await getConnection(env.DB, {
    userId: uid,
    workspaceId: String(job.workspaceId || '').trim() || null,
    tenantId: String(job.tenantId || '').trim() || null,
    targetType: plan.targetType,
    healthAware: false,
  });
  const conn = sel?.connection || null;
  if (!conn) {
    const code = sel?.error || 'connection_missing';
    await writeMoviemodeJobError(env, jobId, job, {
      errorCode: code,
      message:
        plan.renderLane === 'local'
          ? `Mac tunnel unresolved (${code}) — wake the desk and pick dock Local`
          : `VM connection unresolved (${code})`,
    });
    return;
  }

  const targetType = String(conn.target_type || plan.targetType || '').trim();
  if (!targetType) {
    await writeMoviemodeJobError(env, jobId, job, { errorCode: 'target_type_required', message: 'target_type_required' });
    return;
  }
  const connection = { ...conn, target_type: targetType };

  if (plan.renderLane === 'remote' && !env?.PTY_SERVICE && !String(env?.TERMINAL_WS_URL || '').trim()) {
    await writeMoviemodeJobError(env, jobId, job, {
      errorCode: 'pty_unavailable',
      message: 'PTY_SERVICE / TERMINAL_WS_URL not bound for VM export',
    });
    return;
  }

  const cwdRes = deps.resolveCwd
    ? await deps.resolveCwd(env, {
        connection,
        tenantId: String(job.tenantId || '').trim(),
        userId: uid,
        workspaceId: String(job.workspaceId || '').trim(),
      })
    : await resolveTerminalCwd(env, {
        connection,
        tenantId: String(job.tenantId || '').trim(),
        userId: uid,
        workspaceId: String(job.workspaceId || '').trim(),
      });
  const fallbackRoot = deps.resolveRepoRoot
    ? await deps.resolveRepoRoot(env, {
        tenantId: job.tenantId,
        userId: uid,
        workspaceId: job.workspaceId,
      })
    : await resolveMoviemodeRepoRootForSession(env, {
        tenantId: job.tenantId,
        userId: uid,
        workspaceId: job.workspaceId,
      });
  const repoRoot = String(cwdRes?.cwd || fallbackRoot?.repoRoot || '').trim();
  if (!repoRoot) {
    await writeMoviemodeJobError(env, jobId, job, {
      errorCode: cwdRes?.error || 'workspace_context_missing',
      message: cwdRes?.user_message || 'Could not resolve workspace root for MovieMode export',
    });
    return;
  }

  const validation = deps.validateRepo
    ? await deps.validateRepo(env, repoRoot, {
        userId: uid,
        workspaceId: job.workspaceId,
        connection,
      })
    : await validateMoviemodeRepoOnPty(env, repoRoot, {
        userId: uid,
        workspaceId: job.workspaceId,
        connection,
      });
  if (!validation.ok) {
    await writeMoviemodeJobError(env, jobId, job, {
      ...validation,
      workspaceRoot: fallbackRoot?.workspaceRoot || repoRoot,
    });
    return;
  }

  const root = validation.repoRoot;
  await writeJob(env, jobId, {
    ...job,
    status: 'rendering',
    progressPercent: 0,
    repoRoot: root,
    workspaceRoot: fallbackRoot?.workspaceRoot || root,
    repoRootSource: fallbackRoot?.source || cwdRes?.strategy,
    renderLane: plan.renderLane,
  });

  const scriptPath = `${root}/scripts/moviemode-remotion-render.mjs`;
  const sessionFile = `/tmp/moviemode/${jobId}.json`;
  const cmd = [
    `mkdir -p /tmp/moviemode`,
    `cat > ${sessionFile} <<'MMEOF'`,
    JSON.stringify({
      session: job.session,
      config: job.config,
      jobId,
      outputFilename: job.outputFilename,
    }),
    'MMEOF',
    `node ${JSON.stringify(scriptPath)} ${JSON.stringify(sessionFile)}`,
  ].join('\n');

  const execPty = deps.execOnPtyHost || execOnPtyHost;
  const res = await execPty(env, {
    command: cmd,
    cwd: root,
    timeout_ms: 300_000,
    userId: uid,
    workspaceId: job.workspaceId,
    connection,
  });
  const out = `${res.stdout || ''}\n${res.stderr || ''}`;

  const prog = out.match(/PROGRESS:(\d+)/g);
  if (prog?.length) {
    const last = prog[prog.length - 1].match(/PROGRESS:(\d+)/);
    if (last) {
      await writeJob(env, jobId, {
        ...job,
        status: 'rendering',
        progressPercent: parseInt(last[1], 10),
        renderLane: plan.renderLane,
      });
    }
  }

  if (out.includes('RENDER_DONE:')) {
    const ingested = out.includes('INGEST_OK:');
    await writeJob(env, jobId, {
      ...job,
      status: ingested ? 'done' : 'uploading',
      progressPercent: ingested ? 100 : 95,
      r2Key: ingested ? job.r2Key : undefined,
      outputFilename: job.outputFilename,
      renderLane: plan.renderLane,
    });
    return;
  }

  if (!res.ok) {
    await writeMoviemodeJobError(env, jobId, job, {
      errorCode: res.error || 'pty_exec_failed',
      message: res.stderr || res.stdout || `PTY exit ${res.exit_code}`,
    });
    return;
  }

  await writeJob(env, jobId, {
    ...job,
    status: 'queued',
    progressPercent: 0,
    renderLane: plan.renderLane,
    errorMessage: 'Render submitted; poll export-status',
  });
}
