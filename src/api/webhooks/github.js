/**
 * GitHub inbound webhooks — signature verification + durable audit row (D1).
 * Push events are audited only — codebase index is buttons-only (no auto enqueue).
 *
 * Event types actually acted on in this handler:
 *   - `push` — optional code-index enqueue (no-op unless enabled) + SourcePanel realtime
 * All other events (including check_run, check_suite, workflow_run, pull_request)
 * are stored via ingestWebhookEventAndDispatch and only dispatched if
 * agentsam_webhooks.allowed_events matches. Safe to unsubscribe check_run /
 * check_suite / workflow_run on the GitHub App if you only need push (+ PR audit).
 */
import { jsonResponse } from '../../core/auth.js';
import { getVaultSecrets, secretFromVault } from '../../core/vault.js';
import { ingestWebhookEventAndDispatch } from '../../../backend/services/webhooks/ingest.js';
import { patchAgentsamWebhookEventMetadata } from '../../../backend/services/webhooks/ledger.js';
import { broadcastSupabaseRealtime, topicSafe } from '../../core/realtime-broadcast.js';

/** @param {string} a @param {string} b */
function timingSafeEqualUtf8(a, b) {
  const enc = new TextEncoder();
  const ea = enc.encode(a);
  const eb = enc.encode(b);
  if (ea.length !== eb.length) return false;
  let d = 0;
  for (let i = 0; i < ea.length; i += 1) d |= ea[i] ^ eb[i];
  return d === 0;
}

/** @param {string} secret @param {string} message */
async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** @param {Record<string, unknown>} payload */
function branchFromPayload(payload) {
  const ref = payload?.ref;
  if (typeof ref !== 'string') return null;
  if (ref.startsWith('refs/heads/')) return ref.replace('refs/heads/', '');
  if (ref.startsWith('refs/tags/')) return ref.replace('refs/tags/', '');
  return null;
}

/** @param {Record<string, unknown>} payload */
function shaFromPayload(payload) {
  const p = /** @type {Record<string, unknown>} */ (payload || {});
  return (
    /** @type {string | null | undefined} */ (p.after) ||
    /** @type {{ id?: string }} */ (p.head_commit)?.id ||
    /** @type {{ head?: { sha?: string } }} */ (p.pull_request)?.head?.sha ||
    /** @type {{ head_sha?: string }} */ (p.check_suite)?.head_sha ||
    /** @type {{ head_sha?: string }} */ (p.check_run)?.head_sha ||
    /** @type {{ sha?: string }} */ (p.deployment)?.sha ||
    null
  );
}

/** @param {Record<string, unknown>} payload */
function repoFromPayload(payload) {
  const p = /** @type {Record<string, unknown>} */ (payload || {});
  const repo = /** @type {{ full_name?: string } | undefined} */ (p.repository);
  return repo?.full_name ?? null;
}

/** @param {Record<string, unknown>} payload */
function commitMessageFromPayload(payload) {
  const p = /** @type {Record<string, unknown>} */ (payload || {});
  const hc = /** @type {{ message?: string } | undefined} */ (p.head_commit);
  if (hc?.message) return hc.message;
  const commits = /** @type {{ message?: string }[] | undefined} */ (p.commits);
  return commits?.[0]?.message ?? null;
}

/** @param {Record<string, unknown>} payload */
function authorFromPayload(payload) {
  const p = /** @type {Record<string, unknown>} */ (payload || {});
  const push = /** @type {{ name?: string } | undefined} */ (p.pusher);
  const sender = /** @type {{ login?: string } | undefined} */ (p.sender);
  const hc = /** @type {{ author?: { username?: string } } | undefined} */ (p.head_commit);
  return push?.name || sender?.login || hc?.author?.username || null;
}

/**
 * @param {Request} request
 * @param {any} env
 * @param {ExecutionContext} ctx
 */
export async function handleGithubWebhook(request, env, ctx) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let secret = env.GITHUB_WEBHOOK_SECRET;
  if (!secret && env.DB && env.VAULT_KEY) {
    try {
      const vault = await getVaultSecrets(env);
      secret = secretFromVault(vault, env, 'GITHUB_WEBHOOK_SECRET');
    } catch {
      /* vault unavailable */
    }
  }
  if (!secret) {
    return jsonResponse({ error: 'GitHub webhook secret not configured' }, 503);
  }

  const rawBody = await request.text();
  const sigHeader = (request.headers.get('X-Hub-Signature-256') || '').trim();
  const m = /^sha256=([0-9a-fA-F]+)$/.exec(sigHeader);
  if (!m) {
    return jsonResponse({ error: 'invalid signature' }, 401);
  }

  const recvHex = m[1].toLowerCase();
  const expectedHex = (await hmacSha256Hex(secret, rawBody)).toLowerCase();
  if (recvHex.length !== expectedHex.length || !timingSafeEqualUtf8(recvHex, expectedHex)) {
    return jsonResponse({ error: 'invalid signature' }, 401);
  }

  let payload = /** @type {Record<string, unknown>} */ ({});
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return jsonResponse({ error: 'invalid JSON' }, 400);
  }

  const eventType = request.headers.get('X-GitHub-Event') || 'unknown';
  const deliveryId = request.headers.get('X-GitHub-Delivery') || null;
  const ingest = await ingestWebhookEventAndDispatch(env, ctx, {
    tenantId: null,
    workspaceId: null,
    provider: 'github',
    eventType,
    eventId: deliveryId,
    payload,
    endpointPath: '/api/webhooks/github',
    signatureValid: true,
    metadata: {
      repo_full_name: repoFromPayload(payload),
      branch: branchFromPayload(payload),
      commit_sha: shaFromPayload(payload),
      commit_message: commitMessageFromPayload(payload),
      author_username: authorFromPayload(payload),
    },
  });

  // Push indexing is intentionally buttons-only. Record that product decision on the
  // webhook audit row; never retain a dormant auto-enqueue path behind a false flag.
  if (String(eventType).toLowerCase() === 'push') {
    const repo = repoFromPayload(payload);
    const branch = branchFromPayload(payload);
    const commitSha = shaFromPayload(payload);
    if (ingest?.id) {
      const stampSkip = () => patchAgentsamWebhookEventMetadata(env, String(ingest.id), {
        code_index_enqueued: 0,
        code_index_skipped: 'buttons_only_no_push_enqueue',
      });
      if (ctx?.waitUntil) ctx.waitUntil(stampSkip().catch(() => {}));
      else await stampSkip().catch(() => {});
    }

    // Push signal for SourcePanel.tsx — replaces client 30s poll with a
    // Supabase Realtime broadcast keyed by repo. Best-effort, never blocks
    // the webhook response; SourcePanel keeps a long fallback poll if this
    // is missed (broadcast not configured, channel drop, etc).
    if (repo) {
      const runBroadcast = () =>
        broadcastSupabaseRealtime(env, `git-status:${topicSafe(repo)}`, 'push', {
          repo_full_name: repo,
          branch,
          commit_sha: commitSha != null ? String(commitSha) : null,
        });
      if (ctx?.waitUntil) {
        ctx.waitUntil(runBroadcast());
      } else {
        await runBroadcast();
      }
    }
  }

  return jsonResponse({ ok: true, webhook_event_id: ingest?.id || null });
}
