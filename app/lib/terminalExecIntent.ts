import type { ExecLane } from '../src/lib/execLane';

/** Catalog terminal tools (local / remote / sandbox). */
export function isAgentsamTerminalTool(toolName?: string | null): boolean {
  const tn = String(toolName || '').trim();
  return tn.startsWith('agentsam_terminal');
}

/** Heuristic: this chat turn will likely invoke agentsam_terminal_* (cloud desk on mobile). */
export function expectsTerminalExec(
  message: string,
  execLane: ExecLane | string,
  isMobile: boolean,
): boolean {
  const lane = String(execLane || '').trim().toLowerCase();
  if (lane === 'remote' || lane === 'sandbox' || lane === 'local') return true;
  if (isMobile) return true;
  const m = String(message || '').trim();
  if (!m) return false;
  return /\b(git|npm|wrangler|deploy|shell|terminal|status|pytest|vitest|curl|ssh|whoami|pwd|ls |cd |clone|build:|run test)\b/i.test(
    m,
  );
}
