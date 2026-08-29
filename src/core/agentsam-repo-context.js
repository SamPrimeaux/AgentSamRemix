/**
 * agentsam_repo_context — in-app composite (MCP Optimization Spec §5.1).
 * Composes list_commits + get_tree + batch_read via github-worker handlers.
 * Optional AST retrieve when query/symbols provided.
 */
import { retrieveCodebaseAstContext } from './codebase-ast-retrieve.js';

function trim(v) {
  return v == null ? '' : String(v).trim();
}

const DEFAULT_MAX_BYTES = 32768;

/**
 * @param {any} env
 * @param {Record<string, unknown>} params
 * @param {Record<string, unknown>} runContext
 */
export async function executeAgentsamRepoContext(env, params = {}, runContext = {}) {
  const started = Date.now();
  const branch = trim(params.branch || params.ref) || 'main';
  const repo = trim(params.repo);
  const maxFiles = Math.min(30, Math.max(1, Number(params.max_files) || 12));
  const maxBytes = Number(params.max_bytes) > 0 ? Number(params.max_bytes) : DEFAULT_MAX_BYTES;
  const pathPrefix = trim(params.path || params.path_prefix).replace(/^\/+/, '');
  const pathsArg = Array.isArray(params.paths) ? params.paths.map((p) => trim(p)).filter(Boolean) : [];
  const symbols = Array.isArray(params.symbols) ? params.symbols.map((s) => trim(s)).filter(Boolean) : [];
  const query = trim(params.query || params.q) || (symbols.length ? symbols.join(' ') : '');

  const { handlers: ghHandlers } = await import('../../backend/agentsam/tools/github-worker.js');
  const base = { ...(repo ? { repo } : {}), branch, ref: branch };

  const commitsOut = await ghHandlers.github_list_commits?.(
    { ...base, limit: 1 },
    env,
    runContext,
  );
  if (commitsOut?.error) {
    return { ok: false, error: String(commitsOut.error), body: commitsOut };
  }
  const tip = Array.isArray(commitsOut?.commits)
    ? commitsOut.commits[0]
    : Array.isArray(commitsOut?.body?.commits)
      ? commitsOut.body.commits[0]
      : commitsOut?.commit || null;
  const commitSha = tip?.sha || null;

  const treeOut = await ghHandlers.github_get_tree?.(
    { ...base, recursive: true },
    env,
    runContext,
  );
  if (treeOut?.error) {
    return { ok: false, error: String(treeOut.error), body: treeOut };
  }
  let tree = Array.isArray(treeOut?.tree)
    ? treeOut.tree
    : Array.isArray(treeOut?.body?.tree)
      ? treeOut.body.tree
      : [];
  tree = tree.filter((t) => t?.type === 'blob' && typeof t.path === 'string');
  if (pathPrefix) {
    tree = tree.filter((t) => t.path === pathPrefix || t.path.startsWith(`${pathPrefix}/`));
  }

  let selectedPaths = [...pathsArg];
  if (!selectedPaths.length && query) {
    const qLower = query.toLowerCase();
    selectedPaths = tree
      .map((t) => t.path)
      .filter((p) => p.toLowerCase().includes(qLower) || symbols.some((s) => p.includes(s)))
      .slice(0, maxFiles);
  }
  if (!selectedPaths.length) {
    selectedPaths = tree
      .map((t) => t.path)
      .filter((p) => /\.(js|ts|tsx|mjs|cjs|py|sql|md)$/i.test(p))
      .slice(0, maxFiles);
  }
  if (!selectedPaths.length) {
    selectedPaths = tree.map((t) => t.path).slice(0, Math.min(8, maxFiles));
  }

  const filesOut = await ghHandlers.github_batch_read?.(
    {
      ...base,
      files: selectedPaths.map((path) => ({ path })),
      max_bytes: maxBytes,
      metadata_only: params.metadata_only === true,
    },
    env,
    runContext,
  );
  if (filesOut?.error) {
    return { ok: false, error: String(filesOut.error), body: filesOut };
  }
  const files = Array.isArray(filesOut?.files)
    ? filesOut.files
    : Array.isArray(filesOut?.body?.files)
      ? filesOut.body.files
      : [];

  let ast = null;
  if (query) {
    try {
      const workspaceId =
        String(
          runContext.projectExecutionBindings?.workspaceId ||
            runContext.project_execution_workspace_id ||
            runContext.execution_workspace_id ||
            runContext.workspaceId ||
            runContext.workspace_id ||
            '',
        ).trim() || null;
      ast = await retrieveCodebaseAstContext(env, query, {
        topK: Math.min(Math.max(Number(params.top_k) || 8, 1), 32),
        repo: repo || null,
        expand: true,
        hydrate: true,
        workspaceId: workspaceId || undefined,
        userId: runContext.userId ?? runContext.user_id ?? null,
        tenantId: runContext.tenantId ?? runContext.tenant_id ?? null,
        sessionId: runContext.sessionId ?? runContext.session_id ?? null,
        conversationId: runContext.conversationId ?? runContext.conversation_id ?? null,
      });
    } catch (e) {
      ast = { ok: false, error: e?.message || String(e) };
    }
  }

  const treeSlice = tree.slice(0, 200).map((t) => ({
    path: t.path,
    sha: t.sha ?? null,
    size: t.size ?? null,
  }));

  return {
    ok: true,
    body: {
      repo: treeOut?.repo || treeOut?.body?.repo || repo || null,
      branch,
      commit_sha: commitSha,
      tip_commit: tip,
      tree: treeSlice,
      tree_truncated: tree.length > treeSlice.length,
      tree_total: tree.length,
      files,
      paths_selected: selectedPaths,
      ast: ast?.ok === false ? { error: ast.error } : ast,
      elapsed_ms: Date.now() - started,
    },
  };
}
