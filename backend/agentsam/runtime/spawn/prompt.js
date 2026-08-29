// guard-dup-allow: backend spawn peel; shared prompt callers migrate separately.
/**
 * Minimal prompt seam for asynchronous multitask lanes.
 *
 * The lane already carries its task and profile; prompt construction must not
 * reach back into the retiring src/core prompt stack.
 */

export async function buildSystemPrompt(_env, tenantId, _mode, contextBlock, _modeConfig, _route, options = {}) {
  const userId = String(options.userId || '').trim();
  const workspaceId = String(options.workspaceId || '').trim();
  const tenant = String(tenantId || '').trim();
  const context = String(contextBlock || '').trim();
  return [
    'You are an Agent Sam multitask lane. Complete the supplied lane brief using only the tools and identity provided for this turn.',
    tenant ? `tenant_id: ${tenant}` : '',
    workspaceId ? `workspace_id: ${workspaceId}` : '',
    userId ? `user_id: ${userId}` : '',
    context ? `## Lane context\n${context.slice(0, 6000)}` : '',
  ].filter(Boolean).join('\n\n');
}
