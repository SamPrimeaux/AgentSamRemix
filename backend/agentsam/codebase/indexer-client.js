/**
 * Client for IAM-CODEBASE-INDEXER-SERVICE (binding IAM_CODEBASE_INDEXER).
 * Structural parse only — main Worker must not instantiate tree-sitter WASM.
 */
import { buildBridgeAuthHeaders } from '../../auth/bridge-key-auth.js';

/**
 * @param {any} env
 * @returns {boolean}
 */
export function hasCodebaseIndexerService(env) {
  return Boolean(env?.IAM_CODEBASE_INDEXER?.fetch);
}

/**
 * @param {any} env
 * @param {Headers} [headers]
 */
function withServiceKey(env, headers) {
  const h = headers || new Headers({ 'content-type': 'application/json' });
  if (!h.has('content-type')) h.set('content-type', 'application/json');
  const bridgeHeaders = buildBridgeAuthHeaders(env);
  for (const [k, v] of Object.entries(bridgeHeaders)) {
    if (!h.has(k)) h.set(k, v);
  }
  return h;
}

/**
 * @param {any} env
 * @param {string} path
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
async function indexerFetch(env, path, init = {}) {
  const binding = env?.IAM_CODEBASE_INDEXER;
  if (!binding?.fetch) {
    throw new Error('iam_codebase_indexer_binding_missing');
  }
  const url = `https://iam-codebase-indexer-service.internal${path.startsWith('/') ? path : `/${path}`}`;
  const headers = withServiceKey(env, new Headers(init.headers || {}));
  return binding.fetch(
    new Request(url, {
      ...init,
      headers,
    }),
  );
}

/**
 * Warm tree-sitter Parser on the indexer Worker (optional pre-index).
 * @param {any} env
 */
export async function warmCodebaseIndexerService(env) {
  const res = await indexerFetch(env, '/warm', { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) {
    throw new Error(
      `iam_codebase_indexer_warm_failed:${body?.error || res.status}`,
    );
  }
  return body;
}

/**
 * Parse one file via service binding → structural IR.
 * @param {any} env
 * @param {string} content
 * @param {object} file
 * @param {object} context — workspace_id, repo_full_name, revision_sha, run_id, …
 * @returns {Promise<{ symbols: object[], call_sites: object[], import_bindings: object[] }>}
 */
export async function parseStructuralViaIndexerService(env, content, file, context) {
  const payload = {
    content: String(content ?? ''),
    file: {
      path: file?.path,
      language: file?.language,
      git_blob_sha: file?.git_blob_sha ?? null,
      classification: file?.classification,
      parser_id: file?.parser_id ?? null,
    },
    context: {
      workspace_id: context?.workspace_id,
      repo_full_name: context?.repo_full_name,
      revision_sha: context?.revision_sha,
      run_id: context?.run_id,
      index_generation_id: context?.index_generation_id ?? null,
      file_hash: context?.file_hash,
      parser_id: context?.parser_id,
    },
  };

  const res = await indexerFetch(env, '/parse', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`iam_codebase_indexer_parse_invalid_json:status=${res.status}`);
  }

  if (!res.ok || body?.ok === false) {
    const err = String(body?.error || `http_${res.status}`).slice(0, 500);
    throw new Error(`iam_codebase_indexer_parse_failed:${err}`);
  }

  return {
    symbols: Array.isArray(body.symbols) ? body.symbols : [],
    call_sites: Array.isArray(body.call_sites) ? body.call_sites : [],
    import_bindings: Array.isArray(body.import_bindings) ? body.import_bindings : [],
  };
}
