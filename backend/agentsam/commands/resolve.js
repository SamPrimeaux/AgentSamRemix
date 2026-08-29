// guard-dup-allow: backend command peel; legacy command callers migrate separately.
/** Slash-command resolution: catalog first, legacy shell-patterns second. */
import { getActiveAgentSamCommandBySlug } from '../catalog/commands.js';
import { commandHandlerKind, commandHandlerRef, commandShellLine } from '../catalog/command-row.js';
import { isShellCommandTrusted } from '../terminal/command-trust.js';

function trim(value) { return value == null ? '' : String(value).trim(); }
function unresolved() {
  return { resolved: false, command: null, mappedCommand: null, blocked: false, blockReason: null,
    requiresConfirmation: false, riskLevel: 'low' };
}
function patternMatches(message, row) {
  const pattern = trim(row?.pattern);
  if (!pattern) return false;
  const type = trim(row?.pattern_type) || 'exact';
  if (type === 'exact') return message === pattern;
  if (type === 'prefix') return message.startsWith(pattern);
  try {
    if (type === 'regex') return new RegExp(pattern).test(message);
    if (type === 'glob') {
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      return new RegExp(`^${escaped}$`).test(message);
    }
  } catch { return false; }
  return false;
}

export async function resolveAgentCommand(env, opts = {}) {
  const message = trim(opts.message);
  const workspaceId = trim(opts.workspaceId);
  if (!env?.DB || !message || !message.startsWith('/') || !workspaceId) return unresolved();

  const command = await getActiveAgentSamCommandBySlug(env.DB, message, {
    tenantId: opts.tenantId,
    workspaceId,
  });
  if (command) {
    const kind = commandHandlerKind(command);
    const shellLine = commandShellLine(command);
    const mappedCommand = shellLine || message;
    const requiresShellTrust = (kind === 'shell' || kind === 'script') && Boolean(shellLine);
    const userId = trim(opts.userId);
    const trusted = !requiresShellTrust || Boolean(userId && await isShellCommandTrusted(env, {
      userId, workspaceId, command: shellLine,
    }));
    return {
      resolved: true,
      command,
      mappedCommand,
      blocked: !trusted,
      blockReason: trusted ? null : 'Command not in your allowlist for this workspace',
      requiresConfirmation: trusted && Number(command.requires_confirmation) === 1,
      riskLevel: trim(command.risk_level) || 'low',
    };
  }

  const patterns = await env.DB.prepare(
    `SELECT pattern, pattern_type, mapped_command, risk_level, requires_confirmation
       FROM agentsam_command_pattern
      WHERE workspace_id = ? AND is_active = 1
      ORDER BY use_count DESC, created_at ASC`,
  ).bind(workspaceId).all().catch(() => ({ results: [] }));
  const pattern = (patterns.results || []).find((row) => patternMatches(message, row));
  if (!pattern) return unresolved();

  const mappedCommand = trim(pattern.mapped_command);
  if (!mappedCommand) return unresolved();
  const userId = trim(opts.userId);
  const trusted = Boolean(userId && await isShellCommandTrusted(env, {
    userId, workspaceId, command: mappedCommand,
  }));
  return {
    resolved: true,
    command: null,
    mappedCommand,
    blocked: !trusted,
    blockReason: trusted ? null : 'Command not in your allowlist for this workspace',
    requiresConfirmation: trusted && Number(pattern.requires_confirmation) === 1,
    riskLevel: trim(pattern.risk_level) || 'low',
  };
}
