/**
 * Pure approval policy — no DB/auth imports (safe for unit tests).
 */
import { isShellCommandTrusted } from '../../backend/agentsam/terminal/command-trust.js';
import { normalizeAutoRunMode } from '../../backend/identity/index.js';

export function shouldRequireToolApproval(validationResult, modeConfig, userPolicy) {
  void modeConfig;
  if (validationResult?.requiresConfirmation !== true) return false;

  const autoRun = normalizeAutoRunMode(userPolicy?.auto_run_mode);
  if (autoRun === 'allowlist' && validationResult?.allowlistMatched === true) {
    return false;
  }

  return true;
}

/** Policy prefixes + exact agentsam_command_allowlist (Always Run / Settings). */
export async function isCommandPreviewAllowlisted(env, { userId, workspaceId, command }) {
  return isShellCommandTrusted(env, { userId, workspaceId, command });
}
