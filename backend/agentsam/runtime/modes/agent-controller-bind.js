/**
 * Resolve files-rail / github / session bindings for an agent turn.
 */

import { loadAgentSamUserPolicy } from '../../../identity/index.js';

/**
 * @param {any} env
 * @param {any} input
 */
export async function resolveAgentControllerBindings(env, input) {
  const profile = input.profile;
  const body = input.body || {};
  const message = String(input.message || '').trim();
  const bodyActiveRepo = String(body.active_repo ?? body.activeRepo ?? '').trim();
  const selectedGithub = String(
    body.selectedGithubRepoContext ?? body.github_repo_context ?? body.githubRepoContext ?? '',
  ).trim();
  const projectBindings =
    input.projectExecutionBindings && typeof input.projectExecutionBindings === 'object'
      ? input.projectExecutionBindings
      : null;

  const filesSource = String(body.files_source || body.filesSource || '')
    .trim()
    .toLowerCase();
  const filesSourceIsGithub = filesSource === 'github';
  const fsaRootActive =
    body.fsa_root === true ||
    body.fsa_root === 1 ||
    body.fsa_root === '1' ||
    body.local_fsa_connected === true ||
    body.local_fsa_connected === 1 ||
    body.local_fsa_connected === '1' ||
    filesSource === 'local';
  const activeRepo =
    fsaRootActive || (filesSource && !filesSourceIsGithub)
      ? ''
      : bodyActiveRepo || selectedGithub;

  const { userId, tenantId, workspaceId, sessionId, authUser: sessionAuthUser } =
    input.session || {};
  const quickstartBatch = input.quickstartBatch != null ? String(input.quickstartBatch) : '';

  let activeFileEnvelope = input.activeFileEnvelope ?? null;
  if (
    activeFileEnvelope &&
    (fsaRootActive || (filesSource && !filesSourceIsGithub)) &&
    String(activeFileEnvelope.source || '').toLowerCase() === 'github'
  ) {
    activeFileEnvelope = null;
  }

  const userPolicy =
    input.userPolicy && typeof input.userPolicy === 'object'
      ? input.userPolicy
      : await loadAgentSamUserPolicy(env, userId, workspaceId);

  return {
    profile,
    body,
    message,
    projectBindings,
    filesSource,
    filesSourceIsGithub,
    fsaRootActive,
    activeRepo,
    userId,
    tenantId,
    workspaceId,
    sessionId,
    sessionAuthUser,
    quickstartBatch,
    activeFileEnvelope,
    subagentProfileRow: input.subagentProfileRow ?? null,
    handoffResume: input.handoffResume ?? null,
    browserContextPayload: input.browserContextPayload ?? null,
    chatTurnMeta: input.chatTurnMeta ?? null,
    userPolicy,
  };
}
