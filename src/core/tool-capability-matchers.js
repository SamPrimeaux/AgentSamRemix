/** Pure tool-name matchers for capability narrowing (no Worker imports). */

export function isGithubToolName(name) {
  const n = String(name || '');
  return n.startsWith('agentsam_github_') || n.startsWith('github_');
}

export function isTerminalToolName(name) {
  const n = String(name || '');
  return (
    n.startsWith('agentsam_terminal_') ||
    n === 'agentsam_container_exec' ||
    n === 'terminal_run' ||
    n === 'terminal_execute' ||
    n === 'run_command' ||
    n === 'bash' ||
    n === 'python_execute'
  );
}

export function isArtifactOrR2ToolName(name) {
  const n = String(name || '');
  return (
    n.startsWith('agentsam_r2_') ||
    n.startsWith('r2_') ||
    n.startsWith('workspace_') ||
    n === 'get_r2_url' ||
    n.includes('artifact')
  );
}
