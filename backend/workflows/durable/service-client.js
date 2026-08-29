/**
 * Service binding proxy → iam-workflows (Python Workflows orchestrator).
 */
import { buildBridgeAuthHeaders } from '../../auth/bridge-key-auth.js';

export const IAM_WORKFLOWS_ORIGIN = 'https://iam-workflows.meauxbility.workers.dev';

/**
 * @param {any} env
 */
export function hasIamWorkflowsBinding(env) {
  return Boolean(env?.IAM_WORKFLOWS?.fetch);
}

/**
 * @param {any} env
 * @param {string} path
 * @param {RequestInit} [init]
 */
export async function fetchIamWorkflows(env, path, init = {}) {
  const binding = env?.IAM_WORKFLOWS;
  if (!binding?.fetch) {
    return new Response(JSON.stringify({ error: 'IAM_WORKFLOWS binding not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const p = String(path || '/').startsWith('/') ? path : `/${path}`;
  const url = `${IAM_WORKFLOWS_ORIGIN}${p}`;
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const bridgeHeaders = buildBridgeAuthHeaders(env);
  for (const [k, v] of Object.entries(bridgeHeaders)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return binding.fetch(
    new Request(url, {
      ...init,
      headers,
    }),
  );
}

/**
 * @param {any} env
 * @param {string} path
 * @param {Record<string, unknown>} [body]
 * @param {RequestInit} [init]
 */
export async function fetchIamWorkflowsJson(env, path, body = {}, init = {}) {
  const res = await fetchIamWorkflows(env, path, {
    method: 'POST',
    ...init,
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    return { error: data?.error || res.statusText || 'iam_workflows_error', status: res.status, body: data };
  }
  return data;
}

/**
 * @param {any} env
 * @param {string} instanceId
 * @param {Record<string, unknown>} payload
 */
export async function sendIamWorkflowEvent(env, instanceId, payload) {
  const id = String(instanceId || '').trim();
  if (!id) return { error: 'instance_id required' };
  return fetchIamWorkflowsJson(env, `/v1/runs/${encodeURIComponent(id)}/events`, {
    type: 'workflow.approval',
    payload,
  });
}
