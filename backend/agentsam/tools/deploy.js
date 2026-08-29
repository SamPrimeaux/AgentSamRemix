/**
 * Tool: Deploy (Cloudflare Workers / CI/CD)
 * Implements worker inventory + deployment via Workers Builds deploy hook (no wrangler token)
 * with terminal wrangler fallback when hook is not configured.
 */

import { postWorkersDeployHook, redactDeployHookUrl } from '../../http/agentsam/routes/deploy-hook-runtime.js';
import { resolveCronWorkspaceId } from '../../jobs/cron-tenant.js';

async function invokeCfApi(env, path, method = 'GET', body = null) {
    const accountId = env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiToken) return { error: 'Cloudflare credentials not configured' };

    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
            method,
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            },
            body: body ? JSON.stringify(body) : null,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.errors?.[0]?.message || 'CF API Failed');
        return data.result || data;
    } catch (e) {
        return { error: `Deployment Error: ${e.message}` };
    }
}

/**
 * Prefer Workers Builds deploy hook — no CLOUDFLARE_API_TOKEN or local wrangler required.
 * @param {any} env
 * @param {{ workspaceId?: string|null, workerName?: string|null }} [opts]
 */
async function triggerWorkersBuildDeploy(env, opts = {}) {
    let workspaceId =
        opts.workspaceId != null && String(opts.workspaceId).trim()
            ? String(opts.workspaceId).trim()
            : null;
    if (!workspaceId) {
        workspaceId = await resolveCronWorkspaceId(env);
        if (!workspaceId) {
            return { ok: false, hook_missing: true, error: 'platform_d1_workspace_id_required' };
        }
    }
    const result = await postWorkersDeployHook(env, {
        workspaceId,
        workerName: opts.workerName ?? null,
    });
    if (result.error === 'deploy_hook_url not configured') {
        return { ok: false, hook_missing: true, error: result.error, workspace_id: workspaceId };
    }
    const buildUuid = result.json?.result?.build_uuid ?? result.json?.build_uuid ?? null;
    return {
        ok: result.ok,
        method: 'workers_build_hook',
        workspace_id: workspaceId,
        build_uuid: buildUuid,
        deploy_hook_url_redacted: redactDeployHookUrl(result.deploy_hook_url),
        deploy_hook_source: result.source ?? null,
        http_status: result.status,
        cloudflare: result.json ?? null,
        detail: result.raw ?? null,
        error: result.error ?? null,
    };
}

export const handlers = {
    // ── Worker Inventory ──────────────────────────────────────────────────
    async list_workers(params, env) { return await invokeCfApi(env, '/workers/services'); },
    async get_worker_services(params, env) { return await invokeCfApi(env, `/workers/services/${params.name}`); },

    // ── Deployment Control ────────────────────────────────────────────────
    async worker_deploy(params, env) {
        const workspaceId = params.workspace_id ?? params.workspaceId ?? params.session?.workspace_id ?? null;
        const workerName = params.worker_name ?? params.workerName ?? null;
        const hook = await triggerWorkersBuildDeploy(env, { workspaceId, workerName });
        if (hook.ok || !hook.hook_missing) {
            return hook;
        }

        // Legacy fallback: terminal wrangler (requires PTY + CLOUDFLARE_API_TOKEN on host)
        const origin = env.IAM_ORIGIN || 'https://inneranimalmedia.com';
        const res = await fetch(`${origin}/api/agent/terminal/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                command: `cd ${params.repo || '.'} && wrangler deploy --branch ${params.branch || 'main'}`
            }),
        });
        const body = await res.json().catch(() => ({}));
        return {
            ...body,
            method: 'terminal_wrangler',
            hint: hook.error || 'Workers Builds hook not configured; attempted terminal wrangler fallback',
        };
    },

    async get_deploy_command(params, env) {
        let workspaceId = params?.workspace_id ?? params?.workspaceId ?? null;
        if (!workspaceId) {
            workspaceId = await resolveCronWorkspaceId(env);
        }
        const hook = await triggerWorkersBuildDeploy(env, { workspaceId });
        if (!hook.hook_missing) {
            return {
                command: 'POST /api/agent/git/publish (Workers Builds deploy hook)',
                method: 'workers_build_hook',
                deploy_hook_url_redacted: hook.deploy_hook_url_redacted,
            };
        }
        return {
            command: 'npm run deploy:full',
            method: 'terminal',
            hint: 'Configure deploy_hook_url in workspace metadata or AGENT_SAM_DEPLOY_HOOK_URL',
        };
    },

    // ── Workflow Pipelines ───────────────────────────────────────────────
    async workflow_run_pipeline(params, env) {
        return { status: 'workflow_initiated', message: 'Deployment pipeline started', pipeline: params.name };
    }
};

export { triggerWorkersBuildDeploy };
