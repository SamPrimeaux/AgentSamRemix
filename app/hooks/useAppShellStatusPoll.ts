/** App shell health/git/notifications polling (Wave 2 E3).
 * Lane law: only poll the active dock lane's health marker — never wake CF Containers
 * on a timer when dock is Local/VM.
 */
import React, { useCallback, useEffect, useState } from 'react';
import type { AgentNotificationRow } from '../components/StatusBar';
import {
  applyGitStatusPayloadToSetters,
  applyProblemsPayloadToSetters,
} from '../lib/appShellStatusApply';
import { localTunnelVerificationStale } from '../src/lib/platformHealth';
import { coalesceLabel } from '../src/lib/coalesceLabel';
import {
  readIamGitStatusCache,
  writeIamGitStatusCache,
  isIamGitStatusCacheFresh,
} from '../src/iamGitStatusCache';
import { readDashboardBootstrapCache, type DashboardBootstrapPayload } from '../src/loadDashboardBootstrap';
import { IAM_GIT_SYNC_PUBLISH } from '../src/lib/openCommandPalette';
import { execLaneFromTerminalTarget, tryReadDockExecLane, type ExecLane } from '../src/lib/execLane';

export type AppShellStatusSetters = {
  setHealthOk: React.Dispatch<React.SetStateAction<boolean | null>>;
  setSandboxOk: React.Dispatch<React.SetStateAction<boolean | null>>;
  setTunnelHealthy: React.Dispatch<React.SetStateAction<boolean | null>>;
  setTunnelLabel: React.Dispatch<React.SetStateAction<string | null>>;
  setTunnelStale: React.Dispatch<React.SetStateAction<boolean>>;
  setTerminalOk: React.Dispatch<React.SetStateAction<boolean | null>>;
  setAgentNotifications: React.Dispatch<React.SetStateAction<AgentNotificationRow[]>>;
  setGitBranch: React.Dispatch<React.SetStateAction<string>>;
  setGitRepoFullName: React.Dispatch<React.SetStateAction<string>>;
  setGitAhead: React.Dispatch<React.SetStateAction<number | null>>;
  setGitBehind: React.Dispatch<React.SetStateAction<number | null>>;
  setGitTrackingBranch: React.Dispatch<React.SetStateAction<string | null>>;
  setGitHash: React.Dispatch<React.SetStateAction<string | null>>;
  setGitSyncBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setSystemProblems: React.Dispatch<React.SetStateAction<any>>;
  setErrorCount: React.Dispatch<React.SetStateAction<number>>;
  setWarningCount: React.Dispatch<React.SetStateAction<number>>;
  setSecurityShieldAlert: React.Dispatch<React.SetStateAction<any>>;
  setSecurityBannerDismissed: React.Dispatch<React.SetStateAction<boolean>>;
  setToastMsg: React.Dispatch<React.SetStateAction<string | null>>;
};

/** Status path aligned to dock exec_lane. No lane → disconnected (never invent remote). */
export function tunnelStatusPathForExecLane(lane: ExecLane | null | undefined): string {
  if (lane === 'local') return '/api/tunnel/status/local';
  if (lane === 'remote') return '/api/tunnel/status/remote';
  if (lane === 'sandbox') return '/api/tunnel/status/sandbox';
  return '/api/tunnel/status/disconnected';
}

function readSafeDockLane(workspaceId: string | null | undefined): ExecLane | null {
  return tryReadDockExecLane(workspaceId);
}

export function useAppShellStatusPoll(opts: {
  sessionUserId: string | null | undefined;
  authWorkspaceId: string | null | undefined;
  agentsamChatPolicy: unknown;
  maxTabsPolicyRef: React.MutableRefObject<number>;
} & AppShellStatusSetters) {
  const {
    sessionUserId,
    authWorkspaceId,
    agentsamChatPolicy,
    maxTabsPolicyRef,
    setHealthOk,
    setSandboxOk,
    setTunnelHealthy,
    setTunnelLabel,
    setTunnelStale,
    setTerminalOk,
    setAgentNotifications,
    setGitBranch,
    setGitRepoFullName,
    setGitAhead,
    setGitBehind,
    setGitTrackingBranch,
    setGitHash,
    setGitSyncBusy,
    setSystemProblems,
    setErrorCount,
    setWarningCount,
    setSecurityShieldAlert,
    setSecurityBannerDismissed,
    setToastMsg,
  } = opts;

  const [dockLane, setDockLane] = useState<ExecLane | null>(() =>
    readSafeDockLane(authWorkspaceId),
  );

  useEffect(() => {
    setDockLane(readSafeDockLane(authWorkspaceId));
  }, [authWorkspaceId]);

  useEffect(() => {
    const onLane = (e: Event) => {
      const detail = (e as CustomEvent<{ workspaceId?: string; targetType?: string }>).detail;
      const wid = authWorkspaceId?.trim();
      if (wid && detail?.workspaceId && detail.workspaceId !== wid) return;
      if (detail?.targetType) {
        try {
          setDockLane(execLaneFromTerminalTarget(detail.targetType));
          return;
        } catch {
          /* fall through */
        }
      }
      setDockLane(readSafeDockLane(authWorkspaceId));
    };
    window.addEventListener('iam_dock_exec_lane', onLane);
    return () => window.removeEventListener('iam_dock_exec_lane', onLane);
  }, [authWorkspaceId]);

  /** Worker health always; sandbox probe only when dock is Sandbox (no smoke exec). */
  const fetchHealth = useCallback(async () => {
    const lane = dockLane ?? readSafeDockLane(authWorkspaceId);
    try {
      const hr = await fetch('/api/health', { credentials: 'same-origin' });
      const hj = await hr.json().catch(() => ({}));
      if (hr.ok) setHealthOk(hj.status === 'ok' || hr.ok);
      else setHealthOk(false);

      if (lane !== 'sandbox') {
        setSandboxOk(null);
        return;
      }

      const sr = await fetch('/api/sandbox/health', { credentials: 'same-origin' });
      if (sr.ok) {
        const sj = await sr.json().catch(() => ({}));
        setSandboxOk(sj.ok === true);
      } else {
        setSandboxOk(false);
      }
    } catch {
      setHealthOk(false);
      if (lane === 'sandbox') setSandboxOk(false);
      else setSandboxOk(null);
    }
  }, [authWorkspaceId, dockLane, setHealthOk, setSandboxOk]);

  const fetchNotifications = useCallback(async () => {
    const cred = { credentials: 'same-origin' as const };
    try {
      const nr = await fetch('/api/agent/notifications', cred);
      const nj = await nr.json().catch(() => ({}));
      if (nr.ok && Array.isArray(nj.notifications)) {
        setAgentNotifications(nj.notifications as AgentNotificationRow[]);
      }
    } catch {
      /* ignore */
    }
  }, [setAgentNotifications]);

  const applyGitStatusPayload = useCallback(
    (gitData: Parameters<typeof applyGitStatusPayloadToSetters>[0]) => {
      applyGitStatusPayloadToSetters(gitData, {
        setGitBranch,
        setGitRepoFullName,
        setGitAhead,
        setGitBehind,
        setGitTrackingBranch,
      });
    },
    [setGitBranch, setGitRepoFullName, setGitAhead, setGitBehind, setGitTrackingBranch],
  );

  const fetchSecurityShieldPulse = useCallback(async (notify = false) => {
    const cred = { credentials: 'same-origin' as const };
    try {
      const qs = notify ? '?notify=1' : '';
      const res = await fetch(`/api/security/shield-pulse${qs}`, cred);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.alert === true) {
        setSecurityShieldAlert({
          message: String(data.message || 'Security finding detected — view details'),
          details_url: String(data.details_url || '/dashboard/settings/keys#security-findings'),
          open_findings_count: Number(data.open_findings_count) || 0,
          audit_events_24h: Number(data.audit_events_24h) || 0,
        });
        if (notify) setSecurityBannerDismissed(false);
      } else {
        setSecurityShieldAlert(null);
      }
    } catch {
      /* ignore */
    }
  }, [setSecurityBannerDismissed, setSecurityShieldAlert]);

  const applyProblemsPayload = useCallback(
    (probData: Record<string, unknown>) => {
      applyProblemsPayloadToSetters(probData, {
        setSystemProblems,
        setErrorCount,
        setWarningCount,
      });
    },
    [setSystemProblems, setErrorCount, setWarningCount],
  );

  const fetchGitAndProblems = useCallback(async () => {
    const cred = { credentials: 'same-origin' as const };
    const ws = authWorkspaceId?.trim();
    const gitStatusUrl = ws
      ? `/api/agent/git/status?workspace_id=${encodeURIComponent(ws)}`
      : '/api/agent/git/status';
    const cached = readIamGitStatusCache();
    if (isIamGitStatusCacheFresh(cached)) {
      applyGitStatusPayload(cached);
    } else {
      try {
        const gitRes = await fetch(gitStatusUrl, cred);
        const gitData = await gitRes.json().catch(() => ({}));
        if (gitRes.ok) {
          writeIamGitStatusCache({
            branch: gitData.branch ? String(gitData.branch) : undefined,
            repo: gitData.repo ? String(gitData.repo) : undefined,
            repo_full_name: gitData.repo_full_name ? String(gitData.repo_full_name) : undefined,
          });
          applyGitStatusPayload(gitData);
        }
      } catch {
        /* ignore */
      }
    }

    try {
      const problemsUrl = ws
        ? `/api/agent/problems?workspace_id=${encodeURIComponent(ws)}`
        : '/api/agent/problems';
      const probRes = await fetch(problemsUrl, {
        ...cred,
        headers: ws ? { 'X-IAM-Workspace-Id': ws } : undefined,
      });
      const probData = await probRes.json().catch(() => ({}));
      if (probRes.ok && probData && typeof probData === 'object') {
        applyProblemsPayload(probData as Record<string, unknown>);
      }
    } catch {
      /* ignore */
    }
  }, [applyGitStatusPayload, applyProblemsPayload, authWorkspaceId]);

  const fetchTunnelStatusOnly = useCallback(async () => {
    const lane = dockLane ?? readSafeDockLane(authWorkspaceId);
    const path = tunnelStatusPathForExecLane(lane);
    const ws = authWorkspaceId?.trim();
    const url = ws ? `${path}?workspace_id=${encodeURIComponent(ws)}` : path;
    const cred = { credentials: 'same-origin' as const };
    try {
      const tr = await fetch(url, cred);
      const tj = await tr.json().catch(() => ({}));
      if (tr.ok && typeof tj.healthy === 'boolean') {
        setTunnelHealthy(tj.healthy);
        const st = tj.status != null ? String(tj.status) : '';
        const marker = tj.marker != null ? String(tj.marker) : lane || 'disconnected';
        const base =
          st === 'connected' ? 'connected' : st === 'disconnected' ? 'disconnected' : st || null;
        setTunnelLabel(base ? `${marker} · ${base}` : marker);
        if (lane === 'sandbox') {
          setSandboxOk(tj.healthy === true);
        } else if (!lane) {
          setSandboxOk(null);
        }
      } else if (tr.status === 401) {
        setTunnelHealthy(null);
        setTunnelLabel(null);
      } else {
        setTunnelHealthy(false);
        const err =
          tj && typeof tj === 'object' && 'error' in tj
            ? String((tj as { error?: string }).error || '')
            : '';
        setTunnelLabel(err ? err.slice(0, 72) : `tunnel ${tr.status}`);
      }
    } catch {
      setTunnelHealthy(null);
      setTunnelLabel(null);
    }
  }, [authWorkspaceId, dockLane, setSandboxOk, setTunnelHealthy, setTunnelLabel]);

  const fetchTerminalConfigOnly = useCallback(async () => {
    const lane = dockLane ?? readSafeDockLane(authWorkspaceId);
    // PTY health is the VM/local control-plane marker — skip when dock is sandbox
    // (sandbox uses /api/tunnel/status/sandbox instead).
    if (lane === 'sandbox') {
      setTerminalOk(null);
      return;
    }
    const cred = { credentials: 'same-origin' as const };
    try {
      const ter = await fetch('/api/agent/pty/health', cred);
      const tej = await ter.json().catch(() => ({}));
      if (ter.ok) {
        setTerminalOk(tej.status === 'connected');
      } else {
        setTerminalOk(false);
      }
    } catch {
      setTerminalOk(false);
    }
  }, [authWorkspaceId, dockLane, setTerminalOk]);

  const fetchTelemetryPoll = useCallback(async () => {
    fetch('/api/agent/telemetry', { method: 'GET', credentials: 'same-origin' }).catch(() => {});
  }, []);

  useEffect(() => {
    setSystemProblems([]);
    setErrorCount(0);
    setWarningCount(0);
    if (sessionUserId) void fetchGitAndProblems();
  }, [sessionUserId, authWorkspaceId, fetchGitAndProblems, setSystemProblems, setErrorCount, setWarningCount]);

  useEffect(() => {
    const onGithubRepo = () => void fetchGitAndProblems();
    window.addEventListener('iam_workspace_github_repo', onGithubRepo);
    return () => window.removeEventListener('iam_workspace_github_repo', onGithubRepo);
  }, [fetchGitAndProblems]);

  const fetchLiveStatus = useCallback(async () => {
    const cred = { credentials: 'same-origin' as const };

    void fetchHealth();

    const ws = authWorkspaceId?.trim();
    const gitStatusUrl = ws
      ? `/api/agent/git/status?workspace_id=${encodeURIComponent(ws)}`
      : '/api/agent/git/status';
    const cachedGit = readIamGitStatusCache();
    if (isIamGitStatusCacheFresh(cachedGit)) {
      applyGitStatusPayload(cachedGit);
    } else {
      try {
        const gitRes = await fetch(gitStatusUrl, cred);
        const gitData = await gitRes.json().catch(() => ({}));
        if (gitRes.ok) {
          writeIamGitStatusCache({
            branch: gitData.branch ? String(gitData.branch) : undefined,
            repo: gitData.repo ? String(gitData.repo) : undefined,
            repo_full_name: gitData.repo_full_name ? String(gitData.repo_full_name) : undefined,
          });
          applyGitStatusPayload(gitData);
        }
      } catch {
        /* ignore */
      }
    }

    try {
      const problemsUrl = ws
        ? `/api/agent/problems?workspace_id=${encodeURIComponent(ws)}`
        : '/api/agent/problems';
      const probRes = await fetch(problemsUrl, {
        ...cred,
        headers: ws ? { 'X-IAM-Workspace-Id': ws } : undefined,
      });
      const probData = await probRes.json().catch(() => ({}));
      if (probRes.ok && probData && typeof probData === 'object') {
        applyProblemsPayload(probData as Record<string, unknown>);
      }
    } catch {
      /* ignore */
    }

    void fetchTunnelStatusOnly();
    void fetchTerminalConfigOnly();

    try {
      const intRes = await fetch('/api/settings/integrations/connected', cred);
      const intData = await intRes.json().catch(() => ({}));
      if (intRes.ok && intData && typeof intData === 'object') {
        const items = Array.isArray((intData as { items?: unknown[] }).items)
          ? ((intData as { items: unknown[] }).items as Parameters<typeof localTunnelVerificationStale>[0])
          : [];
        setTunnelStale(localTunnelVerificationStale(items));
      } else {
        setTunnelStale(false);
      }
    } catch {
      setTunnelStale(false);
    }

    try {
      const nr = await fetch('/api/agent/notifications', cred);
      const nj = await nr.json().catch(() => ({}));
      if (nr.ok && Array.isArray(nj.notifications)) {
        setAgentNotifications(nj.notifications as AgentNotificationRow[]);
      }
    } catch {
      /* ignore */
    }

    void fetchTelemetryPoll();
  }, [
    fetchHealth,
    fetchTunnelStatusOnly,
    fetchTerminalConfigOnly,
    fetchTelemetryPoll,
    applyGitStatusPayload,
    applyProblemsPayload,
    authWorkspaceId,
    setAgentNotifications,
    setTunnelStale,
  ]);

  const handleGitSyncPublish = useCallback(async () => {
    const ws = authWorkspaceId?.trim();
    setGitSyncBusy(true);
    try {
      const res = await fetch('/api/agent/git/publish', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: ws || undefined }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        build_uuid?: string;
      };
      if (!res.ok || !j.ok) {
        setToastMsg(j.error || `Deploy trigger failed (${res.status})`);
        return;
      }
      const buildHint = j.build_uuid ? ` Build ${String(j.build_uuid).slice(0, 8)}…` : '';
      setToastMsg(`Workers Builds deploy triggered.${buildHint}`);
      void fetchGitAndProblems();
      void fetchLiveStatus();
    } catch (e) {
      setToastMsg(e instanceof Error ? e.message : 'Deploy trigger failed');
    } finally {
      setGitSyncBusy(false);
    }
  }, [authWorkspaceId, fetchGitAndProblems, fetchLiveStatus, setGitSyncBusy, setToastMsg]);

  useEffect(() => {
    const onGitSync = () => void handleGitSyncPublish();
    window.addEventListener(IAM_GIT_SYNC_PUBLISH, onGitSync);
    return () => window.removeEventListener(IAM_GIT_SYNC_PUBLISH, onGitSync);
  }, [handleGitSyncPublish]);

  useEffect(() => {
    if (agentsamChatPolicy && typeof agentsamChatPolicy === 'object') {
      const m = Number((agentsamChatPolicy as { max_tab_count?: unknown }).max_tab_count);
      if (Number.isFinite(m) && m >= 2) {
        maxTabsPolicyRef.current = Math.min(48, Math.max(2, Math.floor(m)));
      }
    }
  }, [agentsamChatPolicy, maxTabsPolicyRef]);

  const applyDashboardBootstrapPayload = useCallback(
    (boot: DashboardBootstrapPayload | null | undefined) => {
      if (!boot) return;
      const st = boot.status;
      if (st) {
        if (st.health?.status === 'ok') setHealthOk(true);
        // Deferred sandbox in bootstrap — do not treat as false/unreachable.
        if (st.sandbox && st.sandbox.deferred !== true && typeof st.sandbox.ok === 'boolean') {
          setSandboxOk(st.sandbox.ok);
        }
        if (Array.isArray(st.notifications)) {
          setAgentNotifications(st.notifications as AgentNotificationRow[]);
        }
        if (st.git) {
          if (st.git.branch) setGitBranch(coalesceLabel(st.git.branch, ''));
          const repo = coalesceLabel(st.git.repo_full_name, '');
          if (repo) setGitRepoFullName(repo);
          if (st.git.git_hash) setGitHash(coalesceLabel(st.git.git_hash, ''));
        }
        if (
          st.tunnel &&
          st.tunnel.deferred !== true &&
          typeof st.tunnel.healthy === 'boolean'
        ) {
          setTunnelHealthy(st.tunnel.healthy);
          const ts = st.tunnel.status != null ? String(st.tunnel.status) : '';
          setTunnelLabel(ts === 'connected' ? 'connected' : ts || null);
        }
        if (st.terminal) {
          if (typeof st.terminal.ready === 'boolean') {
            setTerminalOk(st.terminal.ready);
          } else if (st.terminal.status) {
            setTerminalOk(String(st.terminal.status) === 'connected');
          }
        }
      }
    },
    [
      applyProblemsPayload,
      setAgentNotifications,
      setGitBranch,
      setGitHash,
      setGitRepoFullName,
      setHealthOk,
      setSandboxOk,
      setTerminalOk,
      setTunnelHealthy,
      setTunnelLabel,
    ],
  );

  useEffect(() => {
    const cached = readDashboardBootstrapCache();
    if (cached) applyDashboardBootstrapPayload(cached);
    const onBoot = (e: Event) => {
      const detail = (e as CustomEvent<DashboardBootstrapPayload>).detail;
      applyDashboardBootstrapPayload(detail);
    };
    window.addEventListener('iam_dashboard_bootstrap', onBoot);
    return () => window.removeEventListener('iam_dashboard_bootstrap', onBoot);
  }, [applyDashboardBootstrapPayload]);

  useEffect(() => {
    const onFindings = () => {
      void fetchSecurityShieldPulse(false);
    };
    window.addEventListener('iam-security-findings-changed', onFindings);
    return () => window.removeEventListener('iam-security-findings-changed', onFindings);
  }, [fetchSecurityShieldPulse]);

  useEffect(() => {
    // Polling (ms): health 5m, notifications 2m, git+problems 3m, active-lane tunnel 5m,
    // terminal config 10m, telemetry 5m. Paused while tab hidden.
    if (!sessionUserId) return;

    const ids: number[] = [];
    const clearAll = () => {
      ids.forEach((id) => clearInterval(id));
      ids.length = 0;
    };

    const startAll = () => {
      clearAll();
      if (typeof document !== 'undefined' && document.hidden) return;

      const freshBootstrap = readDashboardBootstrapCache(60_000);
      const bootStatus = freshBootstrap?.status;
      if (freshBootstrap) applyDashboardBootstrapPayload(freshBootstrap);

      // Dashboard L1 is intentionally small. Only suppress an initial domain read
      // when that exact domain was actually present in the cached bootstrap payload.
      if (bootStatus?.health?.status !== 'ok') void fetchHealth();
      if (!Array.isArray(bootStatus?.notifications)) void fetchNotifications();
      if (!bootStatus?.git) void fetchGitAndProblems();
      if (!bootStatus?.terminal) void fetchTerminalConfigOnly();

      // Security, active-lane connectivity, and telemetry are independent L2/live reads.
      void fetchSecurityShieldPulse(true);
      void fetchTunnelStatusOnly();
      void fetchTelemetryPoll();

      ids.push(window.setInterval(() => void fetchHealth(), 300_000));
      ids.push(window.setInterval(() => void fetchNotifications(), 120_000));
      ids.push(window.setInterval(() => void fetchGitAndProblems(), 180_000));
      ids.push(window.setInterval(() => void fetchTunnelStatusOnly(), 300_000));
      ids.push(window.setInterval(() => void fetchTerminalConfigOnly(), 600_000));
      ids.push(window.setInterval(() => void fetchTelemetryPoll(), 300_000));
    };

    startAll();

    const onVis = () => {
      if (document.hidden) clearAll();
      else startAll();
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearAll();
    };
  }, [
    sessionUserId,
    dockLane,
    fetchHealth,
    fetchNotifications,
    fetchGitAndProblems,
    fetchSecurityShieldPulse,
    fetchTunnelStatusOnly,
    fetchTerminalConfigOnly,
    fetchTelemetryPoll,
    applyDashboardBootstrapPayload,
  ]);

  return {
    fetchHealth,
    fetchNotifications,
    fetchGitAndProblems,
    fetchSecurityShieldPulse,
    fetchTunnelStatusOnly,
    fetchTerminalConfigOnly,
    fetchTelemetryPoll,
    fetchLiveStatus,
    handleGitSyncPublish,
    applyDashboardBootstrapPayload,
    applyGitStatusPayload,
    applyProblemsPayload,
  };
}
