/** Dock exec lane — Local / VM / Sandbox via LS_TERMINAL_WS_PREFS only. */

import type { TerminalTarget } from '../../components/LocalTerminalSetup';
import { getTerminalWorkspacePref, patchTerminalWorkspacePref } from './terminalWorkspacePrefs';

export type ExecLane = 'remote' | 'local' | 'sandbox';

export const EXEC_LANE_LABELS: Record<ExecLane, string> = {
  remote: 'Cloud desk',
  local: 'Local Mac',
  sandbox: 'CF container',
};

export const EXEC_LANE_DESCRIPTIONS: Record<ExecLane, string> = {
  remote:
    'GCP cloud desk (terminal.inneranimalmedia.com) — full git/shell/wrangler. Matches dock VM.',
  local: 'Your Mac tunnel — matches dock Local.',
  sandbox: 'CF container pool — matches dock Sandbox.',
};

export function isPlatformOperatorFromPolicy(policy: Record<string, unknown> | null | undefined): boolean {
  if (!policy) return false;
  return (
    policy.platform_operator === 1 ||
    policy.platform_operator === true ||
    policy.is_superadmin === 1 ||
    policy.is_superadmin === true
  );
}

export function execLaneFromTerminalTarget(tt: TerminalTarget | string): ExecLane {
  const t = String(tt || '').trim();
  if (t === 'user_hosted_tunnel') return 'local';
  if (t === 'sandbox') return 'sandbox';
  if (t === 'platform_vm') return 'remote';
  throw new Error('exec_lane_invalid');
}

export function terminalTargetFromExecLane(lane: ExecLane): TerminalTarget {
  if (lane === 'local') return 'user_hosted_tunnel';
  if (lane === 'sandbox') return 'sandbox';
  return 'platform_vm';
}

/** Read dock lane for a workspace. workspaceId required — never invent a lane. */
export function readDockExecLane(workspaceId: string): ExecLane {
  const wid = String(workspaceId || '').trim();
  if (!wid) throw new Error('workspace_id_required');
  const tt = getTerminalWorkspacePref(wid).targetType;
  if (!tt) throw new Error('exec_lane_required');
  return execLaneFromTerminalTarget(tt);
}

/** Null when dock lane unset (status → /api/tunnel/status/disconnected). */
export function tryReadDockExecLane(workspaceId: string | null | undefined): ExecLane | null {
  const wid = workspaceId != null ? String(workspaceId).trim() : '';
  if (!wid) return null;
  try {
    return readDockExecLane(wid);
  } catch {
    return null;
  }
}

/** Persist dock lane for a workspace. workspaceId required. */
export function writeDockExecLane(lane: ExecLane, workspaceId: string): void {
  const wid = String(workspaceId || '').trim();
  if (!wid) throw new Error('workspace_id_required');
  if (lane !== 'remote' && lane !== 'local' && lane !== 'sandbox') {
    throw new Error('exec_lane_invalid');
  }
  patchTerminalWorkspacePref(wid, { targetType: terminalTargetFromExecLane(lane) });
}
