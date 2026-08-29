// Production deploy lifecycle — bridge-authenticated internal endpoint only.
// Ship ledger SSOT: one row in `deployments` (shell path: post-deploy-record.sh).
import { verifyBridgeKey } from '../../backend/auth/bridge-key-auth.js';
import { resolveIamSystemActorId } from '../../backend/identity/system-actor.js';

export async function handleCicdEvent(request, env, ctx) {
  if (!verifyBridgeKey(request, env)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { event, payload } = await request.json();

  switch (event) {
    case 'post_promote':
      return await handlePostPromote(payload, env);
    default:
      return Response.json({ error: `Unknown event: ${event}` }, { status: 400 });
  }
}

async function handlePostPromote(p, env) {
  const deployedBy =
    (typeof env?.SYSTEM_ACTOR_ID === 'string' && env.SYSTEM_ACTOR_ID.trim()) ||
    (await resolveIamSystemActorId(env)) ||
    (typeof p?.deployed_by === 'string' && p.deployed_by.trim()) ||
    'system';

  await env.DB.prepare(`
    INSERT OR IGNORE INTO deployments
      (id, timestamp, status, deployed_by, environment, worker_name,
       triggered_by, git_hash, version, deploy_duration_ms, created_at)
    VALUES (?, datetime('now'), 'success', ?, 'production',
            'inneranimalmedia', ?, ?, ?, ?, datetime('now'))
  `).bind(
    p.worker_version_id,
    deployedBy,
    p.triggered_by,
    p.git_hash,
    p.dashboard_version,
    p.ms_worker,
  ).run();

  return Response.json({ ok: true, event: 'post_promote', tables_written: 1 });
}
