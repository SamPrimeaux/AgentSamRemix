/** PTY WebSocket connect, bootstrap, reconnect, inactivity — used by TerminalSessionPane. */
import {
  useEffect, useRef, useState, useCallback,
  type Dispatch, type MutableRefObject, type RefObject, type SetStateAction,
} from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import {
  INACTIVITY_MS,
  PTY_PROMPT_REPAIR_CMD,
  RETRYABLE_STATES,
  type TerminalBindingReceipt,
  type TerminalConnectionStatus,
  type TerminalSessionPaneProps,
} from './terminalSessionTypes';
import { formatAgentsamModelsToTerminal, isAgentsamModelsSlashLine } from './ptyAssistFormatters';
import {
  closeSocketQuietly,
  emitTerminalOutputLines,
  fitTerminalDimensions,
  normalizePtyEnterInput,
} from './ptyXtermUtils';
import { getOrCreatePtyClientId } from '../../src/lib/ptyClientId';

export type PtyWebsocketApi = {
  status: TerminalConnectionStatus;
  setStatus: Dispatch<SetStateAction<TerminalConnectionStatus>>;
  sessionIdState: string | null;
  setSessionIdState: Dispatch<SetStateAction<string | null>>;
  socketRef: MutableRefObject<WebSocket | null>;
  ptySessionIdRef: MutableRefObject<string | null>;
  intentionalCloseRef: MutableRefObject<boolean>;
  retryCountRef: MutableRefObject<number>;
  retryTimerRef: MutableRefObject<number | null>;
  refreshBootstrapRef: MutableRefObject<() => Promise<void>>;
  activeConnectRef: MutableRefObject<() => void>;
  clearInactivityTimer: () => void;
  reconnectClean: () => void;
  disconnectQuiet: () => void;
  appendBuffer: (text: string) => void;
  handlePromptData: (term: Terminal, data: string) => boolean;
  promptSessionRef: MutableRefObject<{
    buffer: string;
    resolve: (value: string | null) => void;
    mask?: boolean;
    defaultValue?: string;
  } | null>;
};

type Opts = Pick<
  TerminalSessionPaneProps,
  | 'workspaceId'
  | 'targetType'
  | 'hostedConnectionId'
  | 'ptySlot'
  | 'shell'
  | 'visible'
  | 'connectEnabled'
  | 'onConnectionChange'
  | 'onSessionIdChange'
  | 'onBindingChange'
  | 'onTerminalOutputLine'
  | 'onHardFailure'
  | 'onTunnelHealth'
> & {
  xtermRef: RefObject<Terminal | null>;
  fitAddonRef: RefObject<FitAddon | null>;
  terminalRef: RefObject<HTMLDivElement | null>;
};

export function usePtyWebsocket({
  workspaceId,
  targetType = 'platform_vm',
  hostedConnectionId = null,
  ptySlot = '',
  shell = '',
  visible,
  connectEnabled = true,
  onConnectionChange,
  onSessionIdChange,
  onBindingChange,
  onTerminalOutputLine,
  onHardFailure,
  onTunnelHealth,
  xtermRef,
  fitAddonRef,
  terminalRef,
}: Opts): PtyWebsocketApi {
    const socketRef = useRef<WebSocket | null>(null);
    const retryCountRef = useRef<number>(0);
    const retryTimerRef = useRef<number | null>(null);
    const ptySessionIdRef = useRef<string | null>(null);
    const bufferRef = useRef<string>('');
    const statusRef = useRef<TerminalConnectionStatus>('disconnected');
    const outputLineBufRef = useRef('');
    const lastEmittedOutputRef = useRef('');
    const promptRepairSentRef = useRef(false);

    const cachedBootstrapRef = useRef<{
      cfgOk: boolean;
      terminalConfigured: boolean;
      resumeOk: boolean;
      resumeJson: { resumable?: boolean; session_id?: string };
      greeting?: string | null;
      loadedAt: number;
    } | null>(null);

    const [status, setStatus] = useState<TerminalConnectionStatus>('disconnected');
    const [sessionIdState, setSessionIdState] = useState<string | null>(null);
    useEffect(() => {
      statusRef.current = status;
      onConnectionChange?.(status);
    }, [status, onConnectionChange]);
    useEffect(() => {
      onSessionIdChange?.(sessionIdState);
    }, [sessionIdState, onSessionIdChange]);

    const intentionalCloseRef = useRef(false);
    const activeConnectRef = useRef<() => void>(() => {});
    const connectInFlightRef = useRef(false);
    const connectSeqRef = useRef(0);
    const connectDebounceRef = useRef<number | null>(null);
    const boundWorkspaceRef = useRef('');
    const boundTargetRef = useRef<string>('platform_vm');
    /** Always-current lane — reconnectClean must not capture a stale targetType closure. */
    const targetTypeRef = useRef<string>(targetType);
    targetTypeRef.current = targetType;
    const hostedConnectionIdRef = useRef(hostedConnectionId?.trim() || '');
    hostedConnectionIdRef.current = hostedConnectionId?.trim() || '';
    const bootstrapInFlightRef = useRef<Promise<void> | null>(null);
    const refreshBootstrapRef = useRef<() => Promise<void>>(async () => {});
    const scheduleReconnectRef = useRef<(reason: string) => void>(() => {});
    const appendBufferRef = useRef<(text: string) => void>(() => {});
    const inactivityTimerRef = useRef<number | null>(null);
    const lastActivityRef = useRef<number>(Date.now());
    const promptSessionRef = useRef<{
      buffer: string;
      resolve: (value: string | null) => void;
      mask?: boolean;
      defaultValue?: string;
    } | null>(null);

    const handlePromptData = useCallback((term: Terminal, data: string) => {
      const session = promptSessionRef.current;
      if (!session) return false;
      if (data === '\x03') {
        term.writeln('^C');
        session.resolve(null);
        promptSessionRef.current = null;
        return true;
      }
      if (data === '\r' || data === '\n') {
        term.writeln('');
        const out = session.buffer.trim() || session.defaultValue || '';
        session.resolve(out);
        promptSessionRef.current = null;
        return true;
      }
      if (data === '\x7f' || data === '\b') {
        if (session.buffer.length > 0) {
          session.buffer = session.buffer.slice(0, -1);
          term.write('\b \b');
        }
        return true;
      }
      if (data.length === 1 && data >= ' ') {
        session.buffer += data;
        term.write(session.mask ? '*' : data);
        return true;
      }
      return false;
    }, []);

    const clearInactivityTimer = useCallback(() => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    }, []);

    const closeDueToInactivity = useCallback(async () => {
      intentionalCloseRef.current = true;
      clearInactivityTimer();
      const sid = ptySessionIdRef.current;
      if (sid) {
        void fetch('/api/terminal/session/close', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ session_id: sid }),
        }).catch(() => {});
      }
      closeSocketQuietly(socketRef.current);
      socketRef.current = null;
      ptySessionIdRef.current = null;
      setSessionIdState(null);
      setStatus('timed_out');
    }, [clearInactivityTimer]);

    const bumpActivity = useCallback(() => {
      lastActivityRef.current = Date.now();
      if (statusRef.current !== 'connected') return;
      clearInactivityTimer();
      inactivityTimerRef.current = window.setTimeout(() => {
        void closeDueToInactivity();
      }, INACTIVITY_MS) as unknown as number;
    }, [clearInactivityTimer, closeDueToInactivity]);

    const reconnectClean = useCallback(() => {
      intentionalCloseRef.current = false;
      retryCountRef.current = 0;
      connectSeqRef.current += 1;
      clearInactivityTimer();
      closeSocketQuietly(socketRef.current);
      socketRef.current = null;
      void refreshBootstrapRef.current().finally(() => {
        setStatus('connecting');
        activeConnectRef.current();
      });
    }, [clearInactivityTimer]);

    const disconnectQuiet = useCallback(() => {
      intentionalCloseRef.current = true;
      retryCountRef.current = 0;
      connectSeqRef.current += 1;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      clearInactivityTimer();
      closeSocketQuietly(socketRef.current);
      socketRef.current = null;
      ptySessionIdRef.current = null;
      setSessionIdState(null);
      setStatus('disconnected');
    }, [clearInactivityTimer]);

    const _doBootstrap = useCallback(async () => {
      cachedBootstrapRef.current = null;
      const wsId = workspaceId?.trim() ?? '';
      try {
        const cfgUrl = new URL('/api/agent/terminal/config-status', window.location.origin);
        if (wsId) cfgUrl.searchParams.set('workspace_id', wsId);
        cfgUrl.searchParams.set('target_type', targetTypeRef.current);
        const connPin = hostedConnectionIdRef.current;
        if (connPin && targetTypeRef.current === 'user_hosted_tunnel') {
          cfgUrl.searchParams.set('connection_id', connPin);
        }

        const [resumePack, cfgPack] = await Promise.all([
          fetch('/api/terminal/session/resume', {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          }).then(async (r) => ({ r, j: await r.json().catch(() => ({ resumable: false })) })),
          fetch(cfgUrl.toString(), {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          }).then(async (r) => ({ r, j: await r.json().catch(() => ({})) })),
        ]);

        const greeting = await fetch('/api/agent/memory/list', { method: 'GET', credentials: 'same-origin' })
          .then((r) => (r.ok ? r.json() : null))
          .then((data: unknown) => {
            const items = Array.isArray(data) ? (data as { key?: string; value?: string }[]) : [];
            return items.find((m) => m.key === 'STARTUP_GREETING')?.value ?? null;
          })
          .catch(() => null);

        const cfgJson = cfgPack.j as { terminal_configured?: boolean };
        cachedBootstrapRef.current = {
          cfgOk: cfgPack.r.ok,
          terminalConfigured: cfgPack.r.ok && cfgJson.terminal_configured === true,
          resumeOk: resumePack.r.ok,
          resumeJson: (resumePack.j as { resumable?: boolean; session_id?: string }) ?? { resumable: false },
          greeting,
          loadedAt: Date.now(),
        };
      } catch {
        cachedBootstrapRef.current = {
          cfgOk: false,
          terminalConfigured: false,
          resumeOk: false,
          resumeJson: { resumable: false },
          greeting: null,
          loadedAt: Date.now(),
        };
      }
    }, [targetType, workspaceId]);

    const refreshBootstrap = useCallback(async () => {
      if (bootstrapInFlightRef.current) {
        return bootstrapInFlightRef.current;
      }
      const run = _doBootstrap();
      bootstrapInFlightRef.current = run;
      try {
        await run;
      } finally {
        bootstrapInFlightRef.current = null;
      }
    }, [_doBootstrap]);

    useEffect(() => {
      void refreshBootstrap();
    }, [refreshBootstrap]);

    useEffect(() => {
      cachedBootstrapRef.current = null;
      connectSeqRef.current += 1;
      outputLineBufRef.current = '';
      lastEmittedOutputRef.current = '';
    }, [workspaceId, targetType]);

    const scheduleReconnect = useCallback((reason: string) => {
      if (intentionalCloseRef.current) return;
      if (statusRef.current === 'offline') return;
      if (!RETRYABLE_STATES.has(statusRef.current)) return;

      const nextAttempt = retryCountRef.current + 1;
      if (nextAttempt > 5) {
        setStatus('offline');
        xtermRef.current?.writeln(
          `\r\n\x1b[1;31m  ✗ ${reason}\x1b[0m\r\n` +
            `\x1b[38;5;240m  Terminal is offline (5 failed attempts). Tap Retry or switch lane (VM / +).\x1b[0m`,
        );
        onHardFailure?.();
        return;
      }

      retryCountRef.current = nextAttempt;
      const delay = Math.min(2000 * Math.pow(2, nextAttempt - 1), 30_000);
      setStatus('reconnecting');
      xtermRef.current?.writeln(
        `\r\n\x1b[1;31m  ✗ ${reason}\x1b[0m\r\n` +
          `\x1b[38;5;240m  Reconnecting in ${Math.round(delay / 1000)}s (attempt ${nextAttempt})...\x1b[0m`,
      );
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = window.setTimeout(() => {
        if (!intentionalCloseRef.current) activeConnectRef.current();
      }, delay) as unknown as number;
    }, [onHardFailure]);

    const appendBuffer = useCallback((text: string) => {
      bufferRef.current = (bufferRef.current + text).slice(-8000);
    }, []);

    useEffect(() => {
      refreshBootstrapRef.current = refreshBootstrap;
      scheduleReconnectRef.current = scheduleReconnect;
      appendBufferRef.current = appendBuffer;
    }, [refreshBootstrap, scheduleReconnect, appendBuffer]);

    useEffect(() => {
      let isMounted = true;

      const connect = () => {
        if (connectInFlightRef.current || !isMounted || intentionalCloseRef.current) return;
        // Remount / Retry must be able to leave offline|timed_out — those states were
        // previously a hard dead-end and left the VM pill red with a blank pane.
        if (statusRef.current === 'offline' || statusRef.current === 'timed_out') {
          retryCountRef.current = 0;
        }
        const wsId = workspaceId?.trim() ?? '';
        if (!wsId) return;

        connectInFlightRef.current = true;
        const seq = ++connectSeqRef.current;
        setStatus(retryCountRef.current > 0 ? 'reconnecting' : 'connecting');
        const writeStatus = (line: string) => {
          const term = xtermRef.current;
          if (term) {
            term.writeln(line);
            return;
          }
          // Mount race: WS bootstrap can beat xterm mount — retry briefly.
          let n = 0;
          const t = window.setInterval(() => {
            n += 1;
            if (xtermRef.current) {
              window.clearInterval(t);
              xtermRef.current.writeln(line);
            } else if (n >= 40) {
              window.clearInterval(t);
            }
          }, 50);
        };
        writeStatus(
          `\r\n\x1b[38;5;240m  ◈ Connecting (${targetTypeRef.current})…\x1b[0m`,
        );
        void (async () => {
          try {
            ptySessionIdRef.current = null;

            if (!cachedBootstrapRef.current) {
              await refreshBootstrapRef.current();
            }
            if (!isMounted || intentionalCloseRef.current || seq !== connectSeqRef.current) return;

            const boot = cachedBootstrapRef.current;
            if (!boot || boot.cfgOk !== true) {
              setStatus('disconnected');
              writeStatus(
                `\x1b[1;31m  ✗ config-status failed — tap Retry\x1b[0m`,
              );
              scheduleReconnectRef.current('config-status failed');
              return;
            }
            if (boot.terminalConfigured !== true) {
              setStatus('backend_unavailable');
              writeStatus(
                `\x1b[1;31m  ✗ Terminal backend unavailable for target ${targetTypeRef.current}\x1b[0m`,
              );
              writeStatus(
                `\x1b[38;5;240m  Tap Retry, or open VM / + and switch lane (Local · VM · Sandbox).\x1b[0m`,
              );
              // Stay on the pane with the error — do not tear down into a blank dock.
              return;
            }

            const resumeJson = boot.resumeJson ?? { resumable: false };

            closeSocketQuietly(socketRef.current);
            if (!isMounted || intentionalCloseRef.current || seq !== connectSeqRef.current) return;

            const laneNow = targetTypeRef.current;
            const wsHttpUrl = new URL('/api/agent/terminal/ws', window.location.origin);
            wsHttpUrl.searchParams.set('workspace_id', wsId);
            wsHttpUrl.searchParams.set('execution_mode', 'pty');
            wsHttpUrl.searchParams.set('target_type', laneNow);
            const ptyClient = getOrCreatePtyClientId();
            if (ptyClient) wsHttpUrl.searchParams.set('pty_client', ptyClient);
            if (ptySlot) wsHttpUrl.searchParams.set('pty_slot', ptySlot);
            if (shell?.trim()) wsHttpUrl.searchParams.set('shell', shell.trim());
            const connPin = hostedConnectionIdRef.current;
            if (connPin && laneNow === 'user_hosted_tunnel') {
              wsHttpUrl.searchParams.set('connection_id', connPin);
            }
            const wsUrl = wsHttpUrl.href.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');

            const ws = new WebSocket(wsUrl);
            if (seq !== connectSeqRef.current) {
              closeSocketQuietly(ws);
              return;
            }
            socketRef.current = ws;
            if (retryTimerRef.current) {
              clearTimeout(retryTimerRef.current);
              retryTimerRef.current = null;
            }

            const disposeListeners: Array<() => void> = [];
            let closeHandled = false;
            const handleSocketDrop = (reason: string) => {
              if (closeHandled || seq !== connectSeqRef.current) return;
              closeHandled = true;
              disposeListeners.forEach((fn) => fn());
              if (!isMounted || intentionalCloseRef.current) return;
              ptySessionIdRef.current = null;
              setSessionIdState(null);
              scheduleReconnectRef.current(reason);
            };

            const attachXtermToOpenSocket = (term: Terminal) => {
              term.clear();
              if (fitAddonRef.current && terminalRef.current) {
                fitTerminalDimensions(term, fitAddonRef.current, terminalRef.current);
              }

              const onDataSub = term.onData((data) => {
                bumpActivity();
                const payload = normalizePtyEnterInput(data);
                if (payload.endsWith('\r')) {
                  const cmd = payload.replace(/\r+$/, '').trim();
                  if (isAgentsamModelsSlashLine(cmd)) {
                    void formatAgentsamModelsToTerminal((text) => term.write(text));
                    return;
                  }
                }
                if (ws.readyState !== WebSocket.OPEN) return;
                if (payload.endsWith('\r')) {
                  const cmd = payload.replace(/\r+$/, '').trim();
                  if (cmd.startsWith('/')) {
                    ws.send(JSON.stringify({ type: 'slash', line: cmd }));
                    return;
                  }
                }
                ws.send(payload);
              });
              // Debounce + skip unchanged dims. Soft-keyboard / focus refits thrash
              // term.resize; each WS resize is SIGWINCH → Local Mac zsh and remote
              // ExecOS both reprint PS1. Same PTY path on every lane.
              let lastSentCols = 0;
              let lastSentRows = 0;
              let resizeTimer: number | null = null;
              const flushResize = (cols: number, rows: number) => {
                if (ws.readyState !== WebSocket.OPEN) return;
                if (cols === lastSentCols && rows === lastSentRows) return;
                lastSentCols = cols;
                lastSentRows = rows;
                try {
                  ws.send(JSON.stringify({ type: 'resize', cols, rows }));
                } catch {
                  /* ignore */
                }
              };
              const onResizeSub = term.onResize(({ cols, rows }) => {
                if (resizeTimer != null) window.clearTimeout(resizeTimer);
                resizeTimer = window.setTimeout(() => {
                  resizeTimer = null;
                  flushResize(cols, rows);
                }, 200);
              });
              disposeListeners.push(() => {
                if (resizeTimer != null) window.clearTimeout(resizeTimer);
                onDataSub.dispose();
                onResizeSub.dispose();
              });
              // Fit above may have run before this listener existed — send once now.
              flushResize(term.cols, term.rows);

              term.writeln('  \x1b[38;5;82m◈\x1b[0m Worker control-plane: \x1b[38;5;82mACTIVE\x1b[0m');
              term.writeln('  \x1b[38;5;240m◈ Backend mode: pty · target: ' + laneNow + '\x1b[0m');
              if (ptySlot) {
                term.writeln(`  \x1b[38;5;240m◈ Session slot: ${ptySlot}\x1b[0m`);
              }

              if (resumeJson.resumable === true) {
                const sid = resumeJson.session_id ?? '';
                term.writeln(`  \x1b[38;5;240m◈ Resume: session ${sid.slice(0, 8)}…\x1b[0m`);
              }

              const greeting = cachedBootstrapRef.current?.greeting ?? null;
              if (greeting) {
                term.writeln(`\r\n\x1b[1;36m  › ${greeting}\x1b[0m`);
              }
            };

            ws.onopen = () => {
              if (seq !== connectSeqRef.current) return;
              boundWorkspaceRef.current = wsId;
              boundTargetRef.current = laneNow;
              retryCountRef.current = 0;
              outputLineBufRef.current = '';
              lastEmittedOutputRef.current = '';
              promptRepairSentRef.current = false;
              // Socket open ≠ PTY ready — stay yellow until backend state:connected.
              setStatus('connecting');
              lastActivityRef.current = Date.now();
              bumpActivity();
              if (!isMounted || intentionalCloseRef.current) return;

              // Mount race: WS can open before the xterm effect finishes mounting.
              // Wait briefly instead of bailing (which left a blank yellow/red dock).
              const termNow = xtermRef.current;
              if (termNow) {
                attachXtermToOpenSocket(termNow);
                return;
              }
              let tries = 0;
              const waitForTerm = window.setInterval(() => {
                if (seq !== connectSeqRef.current || !isMounted || intentionalCloseRef.current) {
                  window.clearInterval(waitForTerm);
                  return;
                }
                const term = xtermRef.current;
                if (term) {
                  window.clearInterval(waitForTerm);
                  attachXtermToOpenSocket(term);
                  return;
                }
                tries += 1;
                if (tries >= 40) {
                  window.clearInterval(waitForTerm);
                  scheduleReconnectRef.current('terminal UI not ready');
                }
              }, 50);
              disposeListeners.push(() => window.clearInterval(waitForTerm));
            };

            ws.onmessage = (event) => {
              if (seq !== connectSeqRef.current) return;
              bumpActivity();
              try {
                const msg = JSON.parse(event.data as string) as {
                  type?: string;
                  session_id?: string;
                  data?: string;
                  status?: string;
                  error?: string;
                  healthy?: boolean;
                  connections?: number;
                  binding?: TerminalBindingReceipt;
                };
                if (msg.type === 'tunnel_health') {
                  onTunnelHealth?.({
                    healthy: msg.healthy === true,
                    connections: Number(msg.connections) || 0,
                  });
                  return;
                }
                if (msg.type === 'session_id') {
                  const sid = msg.session_id?.trim() ?? '';
                  if (sid) {
                    ptySessionIdRef.current = sid;
                    setSessionIdState(sid);
                  }
                  return;
                }
                if (msg.type === 'state') {
                  if (msg.status === 'connected') {
                    const binding =
                      msg.binding && typeof msg.binding === 'object' ? msg.binding : null;
                    const boundTt = String(binding?.target_type || '').trim();
                    const requestedLane = targetTypeRef.current;
                    if (boundTt && boundTt !== requestedLane) {
                      setStatus('backend_unavailable');
                      onBindingChange?.(null);
                      xtermRef.current?.writeln(
                        `\r\n\x1b[1;31m  TERMINAL_BINDING_MISMATCH requested=${requestedLane} actual=${boundTt}\x1b[0m`,
                      );
                      try {
                        socketRef.current?.close(4000, 'TERMINAL_BINDING_MISMATCH');
                      } catch {
                        /* ignore */
                      }
                      return;
                    }
                    onBindingChange?.(binding);
                    setStatus('connected');
                    // Local Mac zsh already has a clean prompt — skip inject.
                    // Skip on coarse-pointer / soft-keyboard UIs — typed repair + ↵
                    // can spam Enter into the remote PTY (same lane, phone viewport).
                    // Never send bare `stty -echo` as typed input: PTY echo prints it
                    // before mute takes effect (looks broken; does not help).
                    const coarsePointer =
                      typeof window !== 'undefined' &&
                      typeof window.matchMedia === 'function' &&
                      window.matchMedia('(pointer: coarse)').matches;
                    const needsPromptRepair = requestedLane === 'platform_vm' && !coarsePointer;
                    if (
                      needsPromptRepair &&
                      !promptRepairSentRef.current &&
                      socketRef.current?.readyState === WebSocket.OPEN
                    ) {
                      promptRepairSentRef.current = true;
                      const sock = socketRef.current;
                      window.setTimeout(() => {
                        if (sock.readyState !== WebSocket.OPEN) return;
                        try {
                          sock.send(`${PTY_PROMPT_REPAIR_CMD}\r`);
                        } catch {
                          /* ignore */
                        }
                      }, 350);
                    }
                  } else if (msg.status === 'connecting') {
                    setStatus('connecting');
                  } else if (msg.status === 'disconnected') {
                    setStatus('disconnected');
                  } else if (msg.status === 'auth_failed') {
                    setStatus('auth_failed');
                  } else if (msg.status === 'session_expired') {
                    setStatus('session_expired');
                  } else if (msg.status === 'backend_unavailable') {
                    setStatus('backend_unavailable');
                  }
                  if (msg.error) xtermRef.current?.writeln(`\r\n\x1b[1;31m  ${msg.error}\x1b[0m`);
                  return;
                }
                if (msg.type === 'output') {
                  const text = msg.data ?? '';
                  appendBufferRef.current(text);
                  xtermRef.current?.write(text);
                  emitTerminalOutputLines(text, onTerminalOutputLine, outputLineBufRef, lastEmittedOutputRef);
                  return;
                }
              } catch (_) {
                /* binary passthrough */
              }
              const raw = event.data as string;
              appendBufferRef.current(raw);
              xtermRef.current?.write(raw);
              emitTerminalOutputLines(raw, onTerminalOutputLine, outputLineBufRef, lastEmittedOutputRef);
            };

            ws.onerror = () => {
              if (!isMounted || intentionalCloseRef.current || seq !== connectSeqRef.current) return;
              setStatus('disconnected');
              handleSocketDrop('Connection error');
            };

            ws.onclose = (evt) => {
              if (!isMounted || intentionalCloseRef.current || seq !== connectSeqRef.current) return;
              if (evt.code === 1000 && evt.reason === 'superseded') return;
              if (evt.code === 4401) {
                setStatus('session_expired');
                return;
              }
              if (evt.code === 4403) {
                setStatus('auth_failed');
                return;
              }
              if (evt.code === 4503) {
                setStatus('backend_unavailable');
                return;
              }
              setStatus('disconnected');
              handleSocketDrop(`Connection closed (${evt.code || 'no-code'})`);
            };
          } catch (e: unknown) {
            if (!isMounted || intentionalCloseRef.current || seq !== connectSeqRef.current) return;
            setStatus('disconnected');
            scheduleReconnectRef.current(
              `Connection bootstrap failed: ${e instanceof Error ? e.message : String(e)}`,
            );
          } finally {
            if (seq === connectSeqRef.current) connectInFlightRef.current = false;
          }
        })();
      };

      activeConnectRef.current = connect;

      if (connectDebounceRef.current) {
        clearTimeout(connectDebounceRef.current);
        connectDebounceRef.current = null;
      }

      if (!visible || !connectEnabled) {
        intentionalCloseRef.current = true;
        connectSeqRef.current += 1;
        connectInFlightRef.current = false;
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        clearInactivityTimer();
        closeSocketQuietly(socketRef.current);
        socketRef.current = null;
        setStatus('disconnected');
        return () => {
          isMounted = false;
        };
      }

      intentionalCloseRef.current = false;
      const wsId = workspaceId?.trim() ?? '';
      if (!wsId) {
        setStatus('disconnected');
        return () => {
          isMounted = false;
        };
      }

      connectDebounceRef.current = window.setTimeout(() => {
        connectDebounceRef.current = null;
        if (!isMounted || intentionalCloseRef.current) return;
        const existing = socketRef.current;
        const sameBinding =
          boundWorkspaceRef.current === wsId && boundTargetRef.current === targetType;
        if (
          existing &&
          sameBinding &&
          (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
        ) {
          return;
        }
        if (existing && !sameBinding) {
          closeSocketQuietly(existing);
          socketRef.current = null;
        }
        connect();
      }, 120) as unknown as number;

      return () => {
        isMounted = false;
        connectSeqRef.current += 1;
        connectInFlightRef.current = false;
        if (connectDebounceRef.current) {
          clearTimeout(connectDebounceRef.current);
          connectDebounceRef.current = null;
        }
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        clearInactivityTimer();
        closeSocketQuietly(socketRef.current);
        socketRef.current = null;
      };
    }, [visible, connectEnabled, workspaceId, ptySlot, shell, targetType, bumpActivity, clearInactivityTimer, onHardFailure]);

  return {
    status,
    setStatus,
    sessionIdState,
    setSessionIdState,
    socketRef,
    ptySessionIdRef,
    intentionalCloseRef,
    retryCountRef,
    retryTimerRef,
    refreshBootstrapRef,
    activeConnectRef,
    clearInactivityTimer,
    reconnectClean,
    disconnectQuiet,
    appendBuffer,
    handlePromptData,
    promptSessionRef,
  };
}
