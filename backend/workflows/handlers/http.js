import { buildWorkflowParamRoot } from './common.js';

function resolveMappedPayload(config, root) {
  if (!config?.payload_map || typeof config.payload_map !== 'object') return root;
  const out = {};
  for (const [key, raw] of Object.entries(config.payload_map)) {
    if (typeof raw === 'string' && raw.startsWith('$.')) {
      let cur = root;
      for (const part of raw.slice(2).split('.')) cur = cur?.[part];
      out[key] = cur ?? null;
    } else out[key] = raw;
  }
  return out;
}

export async function executeWorkflowHttp(env, handlerKey, input, runContext, node, config = {}) {
  const url = String(config.url || config.endpoint || '').trim();
  if (!url) return { ok: false, error: `http handler missing url: ${handlerKey || node?.node_key || 'unknown'}` };
  const method = String(config.method || 'POST').toUpperCase();
  const headers = { 'Content-Type': 'application/json', ...(config.headers || {}) };
  if (config.auth_secret) {
    const secret = env?.[String(config.auth_secret)];
    if (secret && !headers.Authorization) headers.Authorization = `Bearer ${secret}`;
  }
  const root = buildWorkflowParamRoot(input, runContext);
  const payload = resolveMappedPayload(config, root);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(node?.timeout_ms || config.timeout_ms || 15000));
  try {
    const resp = await fetch(url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(payload), signal: ctrl.signal });
    const text = await resp.text();
    let body = text;
    try { body = JSON.parse(text); } catch {}
    return resp.ok ? { ok: true, output: body, status: resp.status } : { ok: false, error: `http ${resp.status} from ${url}`, output: body };
  } catch (e) {
    return { ok: false, error: `http fetch failed: ${e?.message ?? e}` };
  } finally {
    clearTimeout(timer);
  }
}
