import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import {
  formatAgentsamSdkBootstrapToTerminal,
  agentsamSdkBootstrapCommands,
  type TerminalConnectionStatus,
  type TerminalSessionPaneHandle,
} from '../TerminalSessionPane';
import { fetchLocalTerminalConnection, fetchTerminalTargets, type TerminalTarget } from '../LocalTerminalSetup';
import { runPtyTerminalSetupWizard, type PtyWizardIO } from '../../src/lib/ptyTerminalSetupWizard';
import {
  IAM_TERMINAL_CONNECT,
  IAM_TERMINAL_CONFIGURE,
  IAM_TERMINAL_SETUP_WIZARD,
} from '../../src/lib/openCommandPalette';
import type { TerminalSplashStatus } from '../../src/lib/terminalSplashStatus';
import { fetchTerminalSplashStatus } from '../../src/lib/terminalSplashStatus';
import {
  getTerminalWorkspacePref,
  patchTerminalWorkspacePref,
} from '../../src/lib/terminalWorkspacePrefs';
import {
  LS_SHELL,
  LS_SPLIT,
  SHELL_CHOICES,
  type ShellTab,
  type TerminalLaneAction,
} from './shellTypes';
import type { TerminalBindingReceipt } from './terminalSessionTypes';

export type UseTerminalLaneConnectArgs = {
  workspaceId?: string;
  workspaceLabel?: string;
  iamOrigin?: string;
  workspaceCdCommand?: string;
  targetTypeProp?: TerminalTarget;
  onTargetTypeChange?: (target: TerminalTarget) => void;
  splashStatusProp?: TerminalSplashStatus | null;
  splashStatusLoading?: boolean;
  onConnected?: (cwd: string | null, targetType?: TerminalTarget) => void;
  sessionUserId: string | null;
  autoConnect?: boolean;
  isCollapsed: boolean;
  setIsCollapsed: Dispatch<SetStateAction<boolean>>;
  activeTab: ShellTab;
  setActiveTab: Dispatch<SetStateAction<ShellTab>>;
  primaryPaneRef: RefObject<TerminalSessionPaneHandle | null>;
  secondaryPaneRef: RefObject<TerminalSessionPaneHandle | null>;
};

export function useTerminalLaneConnect({
  workspaceId,
  workspaceLabel = '',
  iamOrigin,
  workspaceCdCommand,
  targetTypeProp,
  onTargetTypeChange,
  splashStatusProp,
  splashStatusLoading = false,
  onConnected,
  sessionUserId,
  autoConnect = false,
  isCollapsed,
  setIsCollapsed,
  activeTab,
  setActiveTab,
  primaryPaneRef,
  secondaryPaneRef,
}: UseTerminalLaneConnectArgs) {
  const [resolvedOrigin, setResolvedOrigin] = useState(
    iamOrigin ?? (typeof window !== 'undefined' ? window.location.origin : 'https://inneranimalmedia.com'),
  );
  const [resolvedCdCmd, setResolvedCdCmd] = useState(workspaceCdCommand);
  const resolvedCdCmdRef = useRef(resolvedCdCmd);
  useEffect(() => {
    resolvedCdCmdRef.current = resolvedCdCmd;
  }, [resolvedCdCmd]);

  const plusMenuRef = useRef<HTMLDivElement>(null);
  const targetMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileTargetMenuRef = useRef<HTMLDivElement | null>(null);

  /** Start / CHOOSE LANE splash retired — lane switch lives on the VM/Local chrome control. */
  const [showSplash, setShowSplash] = useState(false);
  const sdkBootstrapPendingRef = useRef(false);
  const prevWorkspaceIdRef = useRef(workspaceId);
  const terminalTargetRef = useRef<TerminalTarget | null>(null);
  const showSplashRef = useRef(false);
  /** After an explicit VM/+ lane pick, ignore parent recommendedTargetType updates. */
  const userPickedLaneRef = useRef(false);
  const primaryStatusRef = useRef<TerminalConnectionStatus>('disconnected');
  const [targetMenuOpen, setTargetMenuOpen] = useState(false);
  const [primaryStatus, setPrimaryStatus] = useState<TerminalConnectionStatus>('disconnected');
  const [primarySessionId, setPrimarySessionId] = useState<string | null>(null);
  const [secondaryStatus, setSecondaryStatus] = useState<TerminalConnectionStatus>('disconnected');
  const [terminalBinding, setTerminalBinding] = useState<TerminalBindingReceipt | null>(null);
  const [uptime, setUptime] = useState(0);

  const [shellPref, setShellPref] = useState(() => {
    // bash: operator PS1 uses \W / \$ — zsh prints those escapes literally ("broke string").
    if (typeof window === 'undefined') return '/bin/bash';
    try {
      const v = localStorage.getItem(LS_SHELL)?.trim();
      if (v && SHELL_CHOICES.some((c) => c.path === v)) return v;
    } catch {
      /* ignore */
    }
    return '/bin/bash';
  });
  const [splitEnabled, setSplitEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(LS_SPLIT) === '1';
    } catch {
      return false;
    }
  });
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [splitSubOpen, setSplitSubOpen] = useState(false);
  const [setupWizardActive, setSetupWizardActive] = useState(false);
  const [localConnectionId, setLocalConnectionId] = useState<string | null>(() => {
    const wid = workspaceId?.trim() || '';
    return wid ? getTerminalWorkspacePref(wid).localConnectionId ?? null : null;
  });
  const [terminalTarget, setTerminalTarget] = useState<TerminalTarget | null>(() => {
    const wid = workspaceId?.trim() || '';
    return wid ? getTerminalWorkspacePref(wid).targetType : null;
  });

  useEffect(() => {
    const wid = workspaceId?.trim() || '';
    if (!wid) {
      setLocalConnectionId(null);
      return;
    }
    setLocalConnectionId(getTerminalWorkspacePref(wid).localConnectionId ?? null);
  }, [workspaceId]);

  useEffect(() => {
    terminalTargetRef.current = terminalTarget;
  }, [terminalTarget]);

  useEffect(() => {
    showSplashRef.current = showSplash;
  }, [showSplash]);

  useEffect(() => {
    primaryStatusRef.current = primaryStatus;
  }, [primaryStatus]);

  const persistWorkspaceTerminalPref = useCallback(
    (wid: string, patch: Parameters<typeof patchTerminalWorkspacePref>[1]) => {
      if (!wid.trim()) return;
      patchTerminalWorkspacePref(wid, {
        workspaceName: workspaceLabel?.trim() || undefined,
        ...patch,
      });
    },
    [workspaceLabel],
  );

  const refreshTerminalTargets = useCallback(async () => {
    if (!workspaceId?.trim()) return;
    await fetchTerminalTargets(workspaceId);
  }, [workspaceId]);

  const handleTerminalHardFailure = useCallback(() => {
    // Stay on the PTY surface with whatever error text was written — never
    // re-open Start splash and don't wipe the pane via disconnectQuiet.
    if (splitEnabled) secondaryPaneRef.current?.disconnectQuiet();
    setPrimaryStatus((s) => (s === 'connected' || s === 'connecting' || s === 'reconnecting' ? 'offline' : s));
    setSecondaryStatus('disconnected');
  }, [splitEnabled, secondaryPaneRef]);

  const startTerminalConnection = useCallback(
    async (target: TerminalTarget) => {
      userPickedLaneRef.current = true;
      const prev = terminalTargetRef.current;
      setTerminalTarget(target);
      terminalTargetRef.current = target;
      onTargetTypeChange?.(target);
      if (workspaceId?.trim()) {
        persistWorkspaceTerminalPref(workspaceId, {
          targetType: target,
          splashDismissed: true,
          lastConnectedAt: Date.now(),
        });
      }
      if (target === 'user_hosted_tunnel' && workspaceId?.trim()) {
        const { shell: connShell } = await fetchLocalTerminalConnection(workspaceId);
        if (connShell) setShellPref(connShell);
      }
      // Lane change: let TerminalSessionPane's targetType effect reconnect with the
      // new prop. Immediate reconnectClean() raced setState and opened WS as the
      // previous lane (UI said Sandbox, query still target_type=platform_vm).
      if (prev === target && primaryPaneRef.current) {
        primaryPaneRef.current.reconnectClean();
        if (splitEnabled) secondaryPaneRef.current?.reconnectClean();
      }
    },
    [
      splitEnabled,
      workspaceId,
      persistWorkspaceTerminalPref,
      primaryPaneRef,
      secondaryPaneRef,
      onTargetTypeChange,
    ],
  );

  const handleConfigureTerminalSettings = useCallback(async () => {
    setPlusMenuOpen(false);
    setIsCollapsed(false);
    setActiveTab('terminal');
    setShowSplash(false);
    setSetupWizardActive(true);
    primaryPaneRef.current?.disconnectQuiet();

    const pane = primaryPaneRef.current;
    if (!pane || !workspaceId?.trim()) {
      setSetupWizardActive(false);
      pane?.writeAnsi('\r\n\x1b[1;31m  Workspace required for terminal setup.\x1b[0m');
      return;
    }

    const io: PtyWizardIO = {
      writeln: (text) => pane.writeAnsi(`\r\n${text}`),
      write: (text) => pane.writeAnsi(text),
      prompt: (label, opts) => pane.promptLine(label, opts),
      choose: async (title, options) => {
        pane.writeAnsi(`\r\n\x1b[1m  ${title}\x1b[0m\r\n`);
        for (const o of options) {
          pane.writeAnsi(`  ${o.key}) ${o.label}\r\n`);
        }
        const raw = await pane.promptLine('Pick a number');
        if (!raw) return null;
        const pick = options.find((o) => o.key === raw.trim());
        return pick?.key ?? null;
      },
    };

    try {
      await runPtyTerminalSetupWizard(io, {
        workspaceId,
        sessionUserId,
        workerOrigin: resolvedOrigin,
        hostedConnectionId: localConnectionId,
        onHostedConnectionPinned: (connectionId) => {
          const id = connectionId.trim();
          if (!id || !workspaceId?.trim()) return;
          patchTerminalWorkspacePref(workspaceId, { localConnectionId: id });
          setLocalConnectionId(id);
        },
        openKeysSettings: () => {
          window.location.assign('/dashboard/settings/keys');
        },
        onConnectLocal: async () => {
          const targets = await fetchTerminalTargets(workspaceId);
          const connShell = targets?.local?.shell?.trim();
          if (connShell) setShellPref(connShell);
          setShowSplash(false);
          await startTerminalConnection('user_hosted_tunnel');
        },
      });
    } finally {
      setSetupWizardActive(false);
      await refreshTerminalTargets();
    }
  }, [
    workspaceId,
    sessionUserId,
    resolvedOrigin,
    localConnectionId,
    startTerminalConnection,
    refreshTerminalTargets,
    setIsCollapsed,
    setActiveTab,
    primaryPaneRef,
  ]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_SHELL, shellPref);
    } catch {
      /* ignore */
    }
  }, [shellPref]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_SPLIT, splitEnabled ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [splitEnabled]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (plusMenuRef.current && !plusMenuRef.current.contains(t)) {
        setPlusMenuOpen(false);
        setSplitSubOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // targetTypeProp is a workspace-default recommendation only — never clobber a
  // user lane pick (that bug made Local look like it "wouldn't stick" on phone).

  useEffect(() => {
    if (splashStatusProp === undefined) return;
    const cd = splashStatusProp?.workspaceMeta?.cd_command;
    if (cd) setResolvedCdCmd(cd);
    else if (splashStatusProp?.workspaceMeta?.cwd) {
      setResolvedCdCmd(`cd ${JSON.stringify(splashStatusProp.workspaceMeta.cwd)}`);
    }
  }, [splashStatusProp]);

  useEffect(() => {
    if (primaryStatus !== 'connected' || !onConnected) return;
    const cwd =
      splashStatusProp?.workspaceMeta?.cwd ??
      splashStatusProp?.workspace.cwd ??
      null;
    onConnected(cwd, terminalTargetRef.current ?? undefined);
  }, [primaryStatus, onConnected, splashStatusProp]);

  useEffect(() => {
    const wid = workspaceId?.trim() || '';
    const prev = prevWorkspaceIdRef.current?.trim() || '';
    const workspaceChanged = prev !== wid;

    if (prev && workspaceChanged) {
      persistWorkspaceTerminalPref(prev, {
        targetType: terminalTargetRef.current,
        splashDismissed: !showSplashRef.current,
        lastConnectedAt:
          primaryStatusRef.current === 'connected' ? Date.now() : undefined,
      });

      if (primaryStatusRef.current === 'connected') {
        /** PTY is user-scoped — keep session alive; only change cwd for the new workspace. */
        void fetchTerminalSplashStatus(wid, workspaceLabel).then((splash) => {
          const cd =
            splash.workspaceMeta?.cd_command ??
            (splash.workspaceMeta?.cwd
              ? `cd ${JSON.stringify(splash.workspaceMeta.cwd)}`
              : null);
          if (cd) {
            setResolvedCdCmd(cd);
            primaryPaneRef.current?.runCommand(cd);
          }
          persistWorkspaceTerminalPref(wid, {
            workspaceName: splash.workspace.name ?? workspaceLabel,
            cwd: splash.workspaceMeta?.cwd ?? null,
          });
        });
      } else {
        primaryPaneRef.current?.disconnectQuiet();
        if (splitEnabled) secondaryPaneRef.current?.disconnectQuiet();
        setPrimaryStatus('disconnected');
        setSecondaryStatus('disconnected');
      }
    }

    prevWorkspaceIdRef.current = workspaceId;

    if (!wid) return;

    if (workspaceChanged) {
      userPickedLaneRef.current = false;
      const pref = getTerminalWorkspacePref(wid);
      const next = targetTypeProp ?? pref.targetType;
      setTerminalTarget(next);
      terminalTargetRef.current = next;
    } else if (!userPickedLaneRef.current && targetTypeProp != null) {
      // Parent may pass recommendedTargetType from dock pref only (never viewport bias).
      setTerminalTarget(targetTypeProp);
      terminalTargetRef.current = targetTypeProp;
    }
    setShowSplash(false);

    if (splashStatusProp === undefined) {
      void fetchTerminalSplashStatus(wid, workspaceLabel).then((splash) => {
        if (splash.workspaceMeta?.cd_command) {
          setResolvedCdCmd(splash.workspaceMeta.cd_command);
        }
        persistWorkspaceTerminalPref(wid, {
          workspaceName: splash.workspace.name ?? workspaceLabel,
          cwd: splash.workspaceMeta?.cwd ?? null,
          splashDismissed: true,
        });
      });
    }

    // Mount/connectEnabled effect owns first connect. Nudge when idle.
    if (
      primaryStatusRef.current !== 'connected' &&
      primaryStatusRef.current !== 'connecting' &&
      primaryStatusRef.current !== 'reconnecting'
    ) {
      window.setTimeout(() => {
        if (
          primaryStatusRef.current === 'disconnected' ||
          primaryStatusRef.current === 'offline' ||
          primaryStatusRef.current === 'timed_out' ||
          primaryStatusRef.current === 'backend_unavailable'
        ) {
          primaryPaneRef.current?.reconnectClean();
        }
      }, 180);
    }
  }, [
    workspaceId,
    persistWorkspaceTerminalPref,
    splitEnabled,
    targetTypeProp,
    splashStatusProp,
    workspaceLabel,
    autoConnect,
    primaryPaneRef,
    secondaryPaneRef,
  ]);

  useEffect(() => {
    if (primaryStatus !== 'connected' || !sdkBootstrapPendingRef.current) return;
    sdkBootstrapPendingRef.current = false;
    const cmds = agentsamSdkBootstrapCommands(resolvedCdCmdRef.current);
    let delay = 400;
    for (const cmd of cmds) {
      window.setTimeout(() => primaryPaneRef.current?.runCommand(cmd), delay);
      delay += 1200;
    }
  }, [primaryStatus, primaryPaneRef]);

  useEffect(() => {
    if (primaryStatus !== 'connected') {
      setUptime(0);
      return;
    }
    const t = setInterval(() => setUptime((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [primaryStatus]);

  const fmtUptime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
      ? `${h}h${String(m).padStart(2, '0')}m`
      : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const handleSplashAction = useCallback(
    async (action: TerminalLaneAction) => {
      setIsCollapsed(false);
      setActiveTab('terminal');

      if (action === 'cloud') {
        setShowSplash(false);
        if (workspaceId?.trim()) {
          persistWorkspaceTerminalPref(workspaceId, { splashDismissed: true });
        }
        await startTerminalConnection('platform_vm');
        return;
      }

      if (action === 'local') {
        // Explicit user pick — always switch. Do not divert to OAuth/wizard
        // (that left the pill stuck on VM/Sandbox while Local looked ignored).
        setShowSplash(false);
        if (workspaceId?.trim()) {
          const targets = await fetchTerminalTargets(workspaceId);
          const connShell = targets?.local?.shell?.trim();
          if (connShell) setShellPref(connShell);
          persistWorkspaceTerminalPref(workspaceId, { splashDismissed: true });
        }
        await startTerminalConnection('user_hosted_tunnel');
        return;
      }

      if (action === 'sandbox') {
        setShowSplash(false);
        if (workspaceId?.trim()) {
          persistWorkspaceTerminalPref(workspaceId, { splashDismissed: true });
        }
        await startTerminalConnection('sandbox');
        return;
      }

      if (action === 'sdk') {
        setShowSplash(false);
        if (workspaceId?.trim()) {
          persistWorkspaceTerminalPref(workspaceId, { splashDismissed: true });
        }
        const write = (text: string) => primaryPaneRef.current?.writeAnsi(text);
        window.setTimeout(() => {
          void formatAgentsamSdkBootstrapToTerminal(write, {
            cdCommand: resolvedCdCmdRef.current,
            cloudReady: true,
          });
        }, 80);
        sdkBootstrapPendingRef.current = true;
        void startTerminalConnection('platform_vm');
        return;
      }
    },
    [
      startTerminalConnection,
      workspaceId,
      persistWorkspaceTerminalPref,
      setIsCollapsed,
      setActiveTab,
      setShellPref,
    ],
  );

  useEffect(() => {
    if (!autoConnect) return;
    if (!workspaceId?.trim()) return;
    if (setupWizardActive) return;
    // Don't block forever on splashStatusLoading — pane connectEnabled already
    // drives WS; this is a nudge if we're still idle after mount.

    const t = window.setTimeout(() => {
      const tt = terminalTargetRef.current;
      if (!tt) return;
      if (
        primaryStatusRef.current === 'disconnected' ||
        primaryStatusRef.current === 'offline' ||
        primaryStatusRef.current === 'timed_out' ||
        primaryStatusRef.current === 'backend_unavailable'
      ) {
        void startTerminalConnection(tt);
      }
    }, splashStatusLoading ? 600 : 280);
    return () => window.clearTimeout(t);
  }, [
    autoConnect,
    workspaceId,
    splashStatusLoading,
    setupWizardActive,
    startTerminalConnection,
  ]);

  useEffect(() => {
    const onConnect = (e: Event) => {
      const target = (e as CustomEvent<{ target?: string }>).detail?.target;
      if (target === 'local' || target === 'cloud' || target === 'sandbox') {
        void handleSplashAction(target);
      }
    };
    const onWizard = () => void handleConfigureTerminalSettings();
    const onConfigure = () => void handleConfigureTerminalSettings();
    window.addEventListener(IAM_TERMINAL_CONNECT, onConnect as EventListener);
    window.addEventListener(IAM_TERMINAL_SETUP_WIZARD, onWizard);
    window.addEventListener(IAM_TERMINAL_CONFIGURE, onConfigure);
    return () => {
      window.removeEventListener(IAM_TERMINAL_CONNECT, onConnect as EventListener);
      window.removeEventListener(IAM_TERMINAL_SETUP_WIZARD, onWizard);
      window.removeEventListener(IAM_TERMINAL_CONFIGURE, onConfigure);
    };
  }, [handleSplashAction, handleConfigureTerminalSettings]);

  // PTY belongs to the panel, not the Terminal/Output/Problems tab.
  const terminalAreaVisible = !isCollapsed;
  const terminalConnectEnabled = terminalAreaVisible && !setupWizardActive;
  const connectionTargetLabel =
    terminalTarget == null
      ? 'Choose'
      : terminalTarget === 'user_hosted_tunnel'
        ? 'Local'
        : terminalTarget === 'sandbox'
          ? 'Sandbox'
          : 'VM';

  /** Lane + host only — never stuff cwd/pwd into the chrome status strip. */
  const bindingTrustLabel = (() => {
    if (!terminalBinding || primaryStatus !== 'connected') return null;
    const lane =
      terminalBinding.lane === 'local'
        ? 'local'
        : terminalBinding.lane === 'sandbox'
          ? 'sandbox'
          : terminalBinding.lane === 'remote'
            ? 'vm'
            : connectionTargetLabel.toLowerCase();
    const host = String(terminalBinding.host_kind || '').trim() || 'unknown';
    return `${lane} · ${host}`;
  })();

  useEffect(() => {
    if (primaryStatus !== 'connected') setTerminalBinding(null);
  }, [primaryStatus]);

  useEffect(() => {
    if (!targetMenuOpen) return;
    // Bubble-phase pointerdown: capture-phase outside-close raced iOS taps and
    // closed the menu before the VM button's click could open it.
    const onDoc = (e: Event) => {
      const node = e.target as Node;
      const portalMenu =
        typeof document !== 'undefined'
          ? document.querySelector('[data-iam-lane-menu="1"]')
          : null;
      if (
        !targetMenuRef.current?.contains(node) &&
        !mobileTargetMenuRef.current?.contains(node) &&
        !portalMenu?.contains(node)
      ) {
        setTargetMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTargetMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [targetMenuOpen]);

  const switchTerminalLane = useCallback(
    (action: 'local' | 'cloud' | 'sandbox') => {
      setTargetMenuOpen(false);
      void handleSplashAction(action);
    },
    [handleSplashAction],
  );

  return {
    resolvedOrigin,
    resolvedCdCmd,
    plusMenuRef,
    targetMenuRef,
    mobileTargetMenuRef,
    showSplash,
    setShowSplash,
    targetMenuOpen,
    setTargetMenuOpen,
    primaryStatus,
    setPrimaryStatus,
    primarySessionId,
    setPrimarySessionId,
    secondaryStatus,
    setSecondaryStatus,
    uptime,
    fmtUptime,
    shellPref,
    setShellPref,
    splitEnabled,
    setSplitEnabled,
    plusMenuOpen,
    setPlusMenuOpen,
    splitSubOpen,
    setSplitSubOpen,
    setupWizardActive,
    terminalTarget,
    hostedConnectionId: localConnectionId,
    handleTerminalHardFailure,
    handleConfigureTerminalSettings,
    handleSplashAction,
    switchTerminalLane,
    terminalAreaVisible,
    terminalConnectEnabled,
    connectionTargetLabel,
    bindingTrustLabel,
    setTerminalBinding,
  };
}
