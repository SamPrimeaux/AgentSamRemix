/**
 * Bridges workspace activation → terminal panel.
 *
 * Workspace changes update repo/cwd context only. PTY readiness is user-scoped
 * (same physical connection regardless of which workspace is active).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TerminalTarget } from '../components/LocalTerminalSetup';
import {
  fetchTerminalSplashStatus,
  type TerminalSplashStatus,
} from '../src/lib/terminalSplashStatus';
import {
  getTerminalWorkspacePref,
  patchTerminalWorkspacePref,
  type TerminalWorkspacePref,
} from '../src/lib/terminalWorkspacePrefs';
import { LS_TERMINAL_WS_PREFS } from '../src/lib/sessionStorageKeys';

export type { TerminalSplashStatus };
export type WorkspaceTerminalPrefs = TerminalWorkspacePref;

const DEFAULT_PREFS: TerminalWorkspacePref = {
  targetType: null,
  splashDismissed: true,
};

/** @deprecated alias — use getTerminalWorkspacePref */
export function loadPrefsForWorkspace(workspaceId: string): WorkspaceTerminalPrefs {
  return getTerminalWorkspacePref(workspaceId);
}

export function listRecentTerminalWorkspaces(): Array<{ workspaceId: string } & WorkspaceTerminalPrefs> {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_TERMINAL_WS_PREFS);
    if (!raw) return [];
    const all = JSON.parse(raw) as Record<string, WorkspaceTerminalPrefs>;
    return Object.entries(all)
      .filter(([, p]) => p.lastConnectedAt != null)
      .sort(([, a], [, b]) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0))
      .map(([workspaceId, prefs]) => ({ workspaceId, ...DEFAULT_PREFS, ...prefs }));
  } catch {
    return [];
  }
}

/** Dock pref is SSOT — never invent lane from health, viewport, or preferred_lane. */
function dockSelectedTarget(prefs: TerminalWorkspacePref): TerminalTarget | null {
  const tt = prefs.targetType;
  if (tt === 'user_hosted_tunnel' || tt === 'platform_vm' || tt === 'sandbox') return tt;
  return null;
}

export function laneReadyFromStatus(status: TerminalSplashStatus | null): boolean {
  if (!status?.targets) return false;
  if (status.targets.can_run_pty === false) return false;
  const selected = status.selectedTargetType;
  if (selected === 'user_hosted_tunnel') return status.targets.local?.ready === true;
  if (selected === 'platform_vm') return status.targets.cloud?.ready === true;
  if (selected === 'sandbox') return status.targets.sandbox?.ready === true;
  // No dock selection yet — do not invent readiness from any lane.
  return false;
}

type UseTerminalWorkspaceOpts = {
  authWorkspaceId: string | null | undefined;
  onStatusReady?: (workspaceId: string, status: TerminalSplashStatus) => void;
  onWorkspaceChange?: (newWorkspaceId: string, prevWorkspaceId: string | null) => void;
};

export function useTerminalWorkspace({
  authWorkspaceId,
  onStatusReady,
  onWorkspaceChange,
}: UseTerminalWorkspaceOpts) {
  const [splashStatus, setSplashStatus] = useState<TerminalSplashStatus | null>(null);
  const [recommendedTargetType, setRecommendedTargetType] = useState<TerminalTarget | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const onWorkspaceChangeRef = useRef(onWorkspaceChange);
  const onStatusReadyRef = useRef(onStatusReady);
  useEffect(() => {
    onWorkspaceChangeRef.current = onWorkspaceChange;
  }, [onWorkspaceChange]);
  useEffect(() => {
    onStatusReadyRef.current = onStatusReady;
  }, [onStatusReady]);

  const prevWorkspaceRef = useRef<string | null>(null);
  const activeWorkspaceId = authWorkspaceId?.trim() || '';

  const fetchStatus = useCallback(async (workspaceId: string) => {
    const wid = workspaceId.trim();
    if (!wid) {
      setSplashStatus(null);
      return null;
    }

    setStatusLoading(true);
    setStatusError(null);

    try {
      const prefs = getTerminalWorkspacePref(wid);
      const status = await fetchTerminalSplashStatus(wid, '', { targetType: prefs.targetType });
      setSplashStatus(status);
      setRecommendedTargetType(dockSelectedTarget(prefs));
      onStatusReadyRef.current?.(wid, status);

      if (status.workspaceMeta?.name) {
        patchTerminalWorkspacePref(wid, { workspaceName: status.workspaceMeta.name });
      }

      return status;
    } catch (err) {
      setStatusError((err as Error).message);
      setSplashStatus(null);
      return null;
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    const wid = activeWorkspaceId;
    const prev = prevWorkspaceRef.current;

    if (wid && prev && prev !== wid) {
      onWorkspaceChangeRef.current?.(wid, prev);
    }
    prevWorkspaceRef.current = wid || null;

    if (!wid) {
      setSplashStatus(null);
      setRecommendedTargetType(null);
      return;
    }

    let cancelled = false;
    setStatusLoading(true);
    const prefs = getTerminalWorkspacePref(wid);
    void fetchTerminalSplashStatus(wid, '', { targetType: prefs.targetType }).then((status) => {
      if (cancelled) return;
      setSplashStatus(status);
      setRecommendedTargetType(dockSelectedTarget(prefs));
      onStatusReadyRef.current?.(wid, status);
      if (status.workspaceMeta?.name) {
        patchTerminalWorkspacePref(wid, { workspaceName: status.workspaceMeta.name });
      }
      setStatusLoading(false);
    }).catch((err) => {
      if (cancelled) return;
      setStatusError((err as Error).message);
      setSplashStatus(null);
      setStatusLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  const switchToWorkspace = useCallback(
    (workspaceId: string) => {
      const wid = workspaceId.trim();
      if (!wid || wid === prevWorkspaceRef.current) return;
      const prev = prevWorkspaceRef.current;
      prevWorkspaceRef.current = wid;
      onWorkspaceChangeRef.current?.(wid, prev);
      void fetchStatus(wid);
    },
    [fetchStatus],
  );

  const saveTargetType = useCallback((targetType: TerminalTarget) => {
    const wid = activeWorkspaceId.trim();
    if (!wid) return;
    setRecommendedTargetType(targetType);
    patchTerminalWorkspacePref(wid, { targetType });
    void fetchStatus(wid);
  }, [activeWorkspaceId, fetchStatus]);

  const markConnected = useCallback(
    (cwd?: string | null, targetType?: TerminalTarget) => {
      const wid = activeWorkspaceId.trim();
      if (!wid) return;
      const nextTarget = targetType ?? recommendedTargetType;
      if (!nextTarget) return;
      patchTerminalWorkspacePref(wid, {
        splashDismissed: true,
        targetType: nextTarget,
        cwd: cwd ?? null,
        lastConnectedAt: Date.now(),
        workspaceName: splashStatus?.workspaceMeta?.name ?? undefined,
      });
      setRecommendedTargetType(nextTarget);
    },
    [activeWorkspaceId, recommendedTargetType, splashStatus?.workspaceMeta?.name],
  );

  const currentPrefs = activeWorkspaceId
    ? getTerminalWorkspacePref(activeWorkspaceId)
    : DEFAULT_PREFS;

  return {
    activeWorkspaceId,
    splashStatus,
    statusLoading,
    statusError,
    currentPrefs,
    recommendedTargetType,
    ptyReady: laneReadyFromStatus(splashStatus),
    switchToWorkspace,
    saveTargetType,
    setRecommendedTargetType: saveTargetType,
    markConnected,
    refreshStatus: () => (activeWorkspaceId ? fetchStatus(activeWorkspaceId) : Promise.resolve(null)),
    refetchStatus: () => activeWorkspaceId && fetchStatus(activeWorkspaceId),
  };
}
