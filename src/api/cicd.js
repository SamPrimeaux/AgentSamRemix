/**
 * API Service: CI/CD Pipeline Manager
 * Handles smoketests, build tracking, and GitHub workflow integration.
 * Deconstructed from legacy worker.js.
 */
import { getAuthUser, jsonResponse } from '../core/auth.js';
import { handleMcpApi } from './mcp.js';

/**
 * Main dispatcher for CI/CD-related API routes (/api/cicd/*).
 */
export async function handleCidiApi(request, url, env, ctx) {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const pathLower = url.pathname.toLowerCase().replace(/\/$/, '') || '/';
    const method = request.method.toUpperCase();

    if (!env.DB) return jsonResponse({ error: 'DB not configured' }, 503);

    // ── GET /api/cicd/current — most recent run ──
    if (pathLower === '/api/cicd/current' && method === 'GET') {
        const row = await env.DB.prepare(
            `SELECT * FROM cicd_runs WHERE worker_name = 'inneranimal-dashboard' ORDER BY queued_at DESC LIMIT 1`
        ).first();
        return jsonResponse({ cicd_run: row || null });
    }

    // ── POST /api/cicd/run — execute smoke suite ──
    if (pathLower === '/api/cicd/run' && method === 'POST') {
        const runId = crypto.randomUUID();
        const branch = 'main';
        let body = {};
        try { body = await request.json(); } catch (_) { }
        const env_name = body.env === 'sandbox' ? 'sandbox' : 'production';

        await env.DB.prepare(
            `INSERT INTO cicd_pipeline_runs 
           (run_id, env, status, branch, triggered_at) 
           VALUES (?, ?, 'running', ?, datetime('now'))`
        ).bind(runId, env_name, branch).run();

        const sandboxBase = 'https://inneranimal-dashboard.inneranimalmedia.workers.dev';
        const cookie = request.headers.get('cookie') || '';

        const cidiMcpStatus = async () => {
            if (env_name === 'sandbox') {
                const r = await fetch(`${sandboxBase}/api/mcp/status`);
                const json = await r.json().catch(() => ({}));
                return { r, json };
            }
            const u = new URL('https://inneranimalmedia.com/api/mcp/status');
            const req = new Request(u.toString(), { method: 'GET' });
            const r = await handleMcpApi(req, u, env, ctx);
            const json = await r.json().catch(() => ({}));
            return { r, json };
        };

        const cidiMcpInvoke = async (toolName, params = {}) => {
            if (env_name === 'sandbox') {
                const r = await fetch(`${sandboxBase}/api/mcp/invoke`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'cookie': cookie },
                    body: JSON.stringify({ tool_name: toolName, params })
                });
                const json = await r.json().catch(() => ({}));
                return { r, json };
            }
            const u = new URL('https://inneranimalmedia.com/api/mcp/invoke');
            const req = new Request(u.toString(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'cookie': cookie },
                body: JSON.stringify({ tool_name: toolName, params })
            });
            const r = await handleMcpApi(req, u, env, ctx);
            const json = await r.json().catch(() => ({}));
            return { r, json };
        };

        const tests = [
            {
                tool_name: 'mcp_status',
                test_type: 'route',
                run: async () => {
                    const start = Date.now();
                    const { r, json } = await cidiMcpStatus();
                    return {
                        status: r.ok && json.ok === true ? 'pass' : 'fail',
                        latency_ms: Date.now() - start,
                        http_status: r.status,
                        response_preview: JSON.stringify(json).slice(0, 200),
                        error: r.ok && json.ok ? null : 'unexpected response'
                    };
                }
            },
            {
                tool_name: 'github_repos',
                test_type: 'invoke',
                run: async () => {
                    const start = Date.now();
                    const { r, json } = await cidiMcpInvoke('github_repos', {});
                    const pass = r.ok && !json.result?.error && json.result !== undefined;
                    return {
                        status: pass ? 'pass' : 'fail',
                        latency_ms: Date.now() - start,
                        http_status: r.status,
                        response_preview: JSON.stringify(json.result).slice(0, 200),
                        error: pass ? null : (json.result?.error || 'unexpected response')
                    };
                }
            },
            {
                tool_name: 'd1_deploy_record',
                test_type: 'd1',
                run: async () => {
                    const start = Date.now();
                    try {
                        const row = await env.DB.prepare(
                            `SELECT id FROM deployments ORDER BY created_at DESC LIMIT 1`
                        ).first();
                        return {
                            status: row ? 'pass' : 'fail',
                            latency_ms: Date.now() - start,
                            http_status: 200,
                            response_preview: row ? `latest deploy: ${row.id}` : 'no rows',
                            error: row ? null : 'no deploy records found'
                        };
                    } catch (e) {
                        return {
                            status: 'fail',
                            latency_ms: Date.now() - start,
                            http_status: 500,
                            response_preview: null,
                            error: String(e.message)
                        };
                    }
                }
            }
        ];

        const results = [];
        for (const test of tests) {
            try {
                const r = await test.run();
                results.push({ tool_name: test.tool_name, test_type: test.test_type, ...r });
            } catch (e) {
                results.push({
                    tool_name: test.tool_name,
                    test_type: test.test_type,
                    status: 'fail',
                    latency_ms: 0,
                    http_status: 0,
                    error: String(e.message),
                    response_preview: null
                });
            }
        }

        const insertStmt = env.DB.prepare(
            `INSERT INTO cicd_run_steps 
           (id, run_id, tool_name, test_type, status, latency_ms, 
            http_status, error, response_preview, tested_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        );
        await env.DB.batch(
            results.map(r => insertStmt.bind(
                crypto.randomUUID(), runId,
                r.tool_name, r.test_type, r.status,
                r.latency_ms, r.http_status,
                r.error || null, r.response_preview || null
            ))
        );

        const allPassed = results.every(r => r.status === 'pass');
        await env.DB.prepare(
            `UPDATE cicd_pipeline_runs 
           SET status=?, completed_at=datetime('now') 
           WHERE run_id=?`
        ).bind(allPassed ? 'passed' : 'failed', runId).run();

        return jsonResponse({ run_id: runId, status: allPassed ? 'passed' : 'failed', results }, 200);
    }

    // ── GET /api/cicd/runs — last 20 runs ──
    if (pathLower === '/api/cicd/runs' && method === 'GET') {
        const runs = await env.DB.prepare(
            `SELECT run_id, env, status, branch, commit_hash, 
                  triggered_at, completed_at, notes
           FROM cicd_pipeline_runs 
           ORDER BY triggered_at DESC LIMIT 20`
        ).all();

        const runIds = (runs.results || []).map(r => r.run_id);
        let results = [];
        if (runIds.length > 0) {
            const placeholders = runIds.map(() => '?').join(',');
            const res = await env.DB.prepare(
                `SELECT id, run_id, tool_name, test_type, status, 
                    latency_ms, http_status, error, tested_at
             FROM cicd_run_steps 
             WHERE run_id IN (${placeholders})
             ORDER BY tested_at ASC`
            ).bind(...runIds).all();
            results = res.results || [];
        }

        const grouped = (runs.results || []).map(run => ({
            ...run,
            tests: results.filter(r => r.run_id === run.run_id)
        }));

        return jsonResponse(grouped, 200);
    }

    return jsonResponse({ error: 'Route not found' }, 404);
}
