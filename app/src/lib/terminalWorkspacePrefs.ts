import type { TerminalTarget } from '../../components/LocalTerminalSetup';
import { LS_TERMINAL_WS_PREFS } from './sessionStorageKeys';

export type TerminalWorkspacePref = {
  /** Persisted operator lane. New Remix workspaces start on the built-in VPC VM. */
  targetType: TerminalTarget | null;
  splashDismissed: boolean;
  workspaceName?: string;
  cwd?: string | null;
  lastConnectedAt?: number;
  /** Pinned user_hosted_tunnel terminal_connections.id for multi-machine local lane. */
  localConnectionId?: string | null;
};

function readAll(): Record<string, TerminalWorkspacePref> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(LS_TERMINAL_WS_PREFS);
    if (!raw?.trim()) return {};
    const parsed = JSON.parse(raw) as Record<string, TerminalWorkspacePref>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(prefs: Record<string, TerminalWorkspacePref>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_TERMINAL_WS_PREFS, JSON.stringify(prefs));
  } catch {
    /* ignore quota */
  }
}

function normalizeStoredTargetType(raw: unknown): TerminalTarget | null {
  const t = String(raw || '').trim();
  if (t === 'user_hosted_tunnel' || t === 'platform_vm' || t === 'sandbox') return t;
  return null;
}

/**
 * New workspace → platform VM. The VM is a bound AgentSamRemix service, not a
 * per-user connection record, so it is safe as the zero-config default. An
 * explicit saved Local/Sandbox choice is still preserved.
 */
export function getTerminalWorkspacePref(workspaceId: string): TerminalWorkspacePref {
  const wid = workspaceId.trim();
  if (!wid) {
    return { targetType: null, splashDismissed: true };
  }
  const row = readAll()[wid];
  if (!row) {
    return { targetType: 'platform_vm', splashDismissed: true };
  }
  return {
    targetType: normalizeStoredTargetType(row.targetType) ?? 'platform_vm',
    splashDismissed: true,
    workspaceName: row.workspaceName,
    cwd: row.cwd ?? null,
    lastConnectedAt: row.lastConnectedAt,
    localConnectionId:
      typeof row.localConnectionId === 'string' && row.localConnectionId.trim()
        ? row.localConnectionId.trim()
        : null,
  };
}

export function patchTerminalWorkspacePref(
  workspaceId: string,
  patch: Partial<TerminalWorkspacePref>,
): TerminalWorkspacePref {
  const wid = workspaceId.trim();
  if (!wid) return { targetType: null, splashDismissed: true };
  const all = readAll();
  const next: TerminalWorkspacePref = {
    ...getTerminalWorkspacePref(wid),
    ...patch,
  };
  if (patch.targetType !== undefined) {
    next.targetType = normalizeStoredTargetType(patch.targetType);
  }
  all[wid] = next;
  writeAll(all);
  if (typeof window !== 'undefined' && patch.targetType !== undefined) {
    try {
      window.dispatchEvent(
        new CustomEvent('iam_dock_exec_lane', {
          detail: { workspaceId: wid, targetType: next.targetType },
        }),
      );
    } catch {
      /* ignore */
    }
  }
  return next;
}

export function listTerminalWorkspaceSessions(excludeWorkspaceId?: string): TerminalWorkspacePref[] {
  const exclude = excludeWorkspaceId?.trim() || '';
  return Object.entries(readAll())
    .filter(([id, pref]) => id !== exclude && pref.splashDismissed)
    .map(([, pref]) => pref)
    .sort((a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0));
}

/** Map splash lane key → connection target_type. null when unset. */
export function targetFromSplashLane(
  lane: 'local' | 'cloud' | 'sandbox' | null,
): TerminalTarget | null {
  if (lane === 'local') return 'user_hosted_tunnel';
  if (lane === 'sandbox') return 'sandbox';
  if (lane === 'cloud') return 'platform_vm';
  return null;
}
