/**
 * Execution resource policy — command-time routing only.
 *
 * This deliberately does NOT classify user messages or pick tools before the model.
 * It protects execution targets after a terminal tool has been selected.
 */

const HEAVY_PATTERNS = [
  /\b(?:vite|playwright|puppeteer|remotion)\b/i,
  /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?build\b/i,
  /\b(?:npm\s+ci|npm\s+install|pnpm\s+install|yarn\s+install)\b/i,
  /\b(?:docker|podman)\s+build\b/i,
  /\bwrangler\s+(?:pages|containers?)\b/i,
  /\b(?:codebase|repo)[-_ ]?(?:index|reindex|embed)\b/i,
  /\b(?:tree[- ]sitter|ast)\b.*\b(?:index|parse|scan)\b/i,
  /\b(?:blender|freecad|openscad|ffmpeg)\b/i,
];

const LIGHT_PATTERNS = [
  /^\s*(?:git\s+(?:status|diff|log|show|branch|fetch|rev-parse|ls-files|worktree\s+list)|pwd|whoami|ls|find|grep|rg|sed|cat|head|tail|wc|df|du|free|ps)\b/i,
  /^\s*node\s+scripts\/(?:guard|assert|audit|smoke)[^\s]*\.m?js\b/i,
  /^\s*npm\s+run\s+(?:guard|assert|audit|smoke)(?::[^\s]+)?\b/i,
];

/** @typedef {'tiny'|'light'|'heavy'|'unknown'} ResourceClass */

/**
 * Classify an already-selected terminal command by resource risk.
 * Unknown is intentionally conservative: it is not automatically moved.
 * @param {string} command
 * @returns {{resource_class: ResourceClass, sandbox_preferred: boolean, vm_safe: boolean, reason: string}}
 */
export function classifyExecutionResource(command) {
  const raw = String(command || '').trim();
  if (!raw) return { resource_class: 'tiny', sandbox_preferred: false, vm_safe: true, reason: 'empty_or_noop' };
  if (HEAVY_PATTERNS.some((re) => re.test(raw))) {
    return { resource_class: 'heavy', sandbox_preferred: true, vm_safe: false, reason: 'known_heavy_command' };
  }
  if (LIGHT_PATTERNS.some((re) => re.test(raw))) {
    const tiny = /^(?:\s*(?:pwd|whoami|ls|git\s+(?:status|branch|rev-parse))\b)/i.test(raw);
    return { resource_class: tiny ? 'tiny' : 'light', sandbox_preferred: false, vm_safe: true, reason: 'known_control_plane_command' };
  }
  return { resource_class: 'unknown', sandbox_preferred: false, vm_safe: true, reason: 'unclassified_command' };
}

/**
 * Known-heavy platform-operator remote work may move off the small VM to sandbox.
 * Explicit local/sandbox lanes are left alone; missing/invalid lane → no remap.
 */
export function shouldRemapRemoteToSandbox(toolKey, execLane, isPlatformOperator, command) {
  if (String(toolKey || '').trim() !== 'agentsam_terminal_remote') return false;
  if (!isPlatformOperator) return false;
  const lane = String(execLane ?? '')
    .trim()
    .toLowerCase();
  if (lane !== 'remote') return false;
  return classifyExecutionResource(command).sandbox_preferred;
}

/**
 * Hard admission boundary for the small operator VM. Known-heavy commands do not run there
 * unless an explicit platform override is provided by trusted server-side context.
 */
export function evaluateRemoteVmAdmission(command, opts = {}) {
  const resource = classifyExecutionResource(command);
  const override = opts.allowHeavyRemote === true;
  if (resource.resource_class === 'heavy' && !override) {
    return {
      allowed: false,
      resource,
      error: 'remote_vm_resource_policy_denied',
      hint: 'Known-heavy command must run in agentsam_terminal_sandbox; remote VM is control-plane first.',
    };
  }
  return { allowed: true, resource, error: null, hint: null };
}
