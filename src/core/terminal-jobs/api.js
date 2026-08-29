import { getTerminalJob, appendTerminalJobArtifact, terminalJobFromRow } from './store.js';
import { submitTerminalJob } from './submit.js';
import { cancelTerminalJob } from './cancellation.js';
import { updateTerminalJobProgress } from './runner.js';
import { handleTerminalJobEventStream, publishTerminalJobEvent } from './events.js';

export async function handleTerminalJobsApi(session, request, url) {
  const path = url.pathname;
  if (path === '/terminal/jobs' && request.method === 'GET') {
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50) || 50));
    const status = String(url.searchParams.get('status') || '').trim();
    const rows = status
      ? [...session.sql.exec(`SELECT * FROM terminal_jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?`, status, limit)]
      : [...session.sql.exec(`SELECT * FROM terminal_jobs ORDER BY created_at DESC LIMIT ?`, limit)];
    return Response.json({ ok: true, jobs: rows.map(terminalJobFromRow) });
  }
  if (path === '/terminal/jobs' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    if (body?.user_id) session.ptSessionUserId = String(body.user_id).trim();
    if (body?.workspace_id) session.workspaceId = String(body.workspace_id).trim();
    if (body?.tenant_id) session.ptSessionTenantId = String(body.tenant_id).trim();
    if (body?.target_type) session.requestedTargetType = String(body.target_type).trim();
    if (body?.target_id) session.requestedConnectionId = String(body.target_id).trim();
    let job;
    try { job = submitTerminalJob(session, body); }
    catch (e) { return Response.json({ ok: false, error: String(e?.message || e) }, { status: 400 }); }
    return Response.json({ ok: true, accepted: true, job_id: job.job_id, status: job.status, deduped: job.deduped === true, job }, { status: 202 });
  }

  const match = path.match(/^\/terminal\/jobs\/([^/]+)(?:\/(events|cancel|artifacts|progress))?$/);
  if (!match) return null;
  const jobId = decodeURIComponent(match[1]);
  const action = match[2] || null;

  if (!action && request.method === 'GET') {
    const job = getTerminalJob(session, jobId);
    return job ? Response.json({ ok: true, job }) : Response.json({ ok: false, error: 'job_not_found' }, { status: 404 });
  }
  if (action === 'events' && request.method === 'GET') {
    if (!getTerminalJob(session, jobId)) return Response.json({ ok: false, error: 'job_not_found' }, { status: 404 });
    return handleTerminalJobEventStream(session, url, jobId);
  }
  if (action === 'cancel' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const job = cancelTerminalJob(session, jobId, String(body?.reason || 'cancelled_by_user'));
    return job ? Response.json({ ok: true, job }) : Response.json({ ok: false, error: 'job_not_found' }, { status: 404 });
  }
  if (action === 'progress' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const job = updateTerminalJobProgress(session, jobId, body?.progress, body);
    return job ? Response.json({ ok: true, job }) : Response.json({ ok: false, error: 'job_not_found' }, { status: 404 });
  }
  if (action === 'artifacts' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const job = appendTerminalJobArtifact(session, jobId, body?.artifact ?? body);
    if (!job) return Response.json({ ok: false, error: 'job_not_found_or_invalid_artifact' }, { status: 404 });
    publishTerminalJobEvent(session, jobId, 'artifact', { artifact_refs: job.artifact_refs });
    return Response.json({ ok: true, job });
  }
  return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
}
