export async function routeResolveGitHubToken() {
  return { error: 'No GitHub token. Re-authenticate via GitHub OAuth.', status: 401 };
}
export async function routeFetchWorkspaceGithubRepo() {
  return { error: 'no_github_repo', status: 200 };
}
export async function routeFetchAgentGitStatus() { return { ok: true, branch: 'main', clean: true }; }
export async function routeFetchGitStatusFromGitHub(...args) { return routeFetchAgentGitStatus(...args); }
export async function routeSetUserWorkspaceActiveBranch(_env, _user, _request, body) {
  return { ok: true, branch: body?.branch || 'main' };
}
export async function routeCloneGithubRepository() { return { ok: false, error: 'github_clone_unavailable', status: 503 }; }
export async function routeMerkleBuildGithub() { return { ok: false, error: 'merkle_unavailable' }; }
export async function routeMerkleBuildFromEntries() { return { ok: false, error: 'merkle_unavailable' }; }
export async function routeMerkleGet() { return { ok: false, error: 'merkle_unavailable' }; }
export async function routeMerkleCompare() { return { ok: false, error: 'merkle_unavailable' }; }
export async function routeMerkleExplain() { return { ok: false, error: 'merkle_unavailable' }; }
export async function routeMerkleList() { return { ok: true, snapshots: [] }; }
export async function routeMerkleDelete() { return { ok: false, error: 'merkle_unavailable' }; }
export async function routeMerkleBuildExecOsGit() { return { ok: false, error: 'merkle_unavailable' }; }
export async function routeResolveTerminalWorkspaceId(_env, _request, authUser, requested) {
  const workspaceId = String(requested || authUser?.active_workspace_id || '').trim();
  return workspaceId ? { workspaceId } : { workspaceId: '', error: 'workspace_required' };
}
export async function routePostWorkersDeployHook() { return { ok: false, error: 'deploy_hook_unavailable', status: 503 }; }
export function routeRedactDeployHookUrl(value) { return value ? '[configured]' : null; }
export async function routeNotifySam() { return { ok: true }; }
export async function routeRunTerminalCommand() { return { ok: false, error: 'terminal_command_unavailable', status: 503 }; }
export async function routeGetSelectedTerminalConnection() { return null; }
