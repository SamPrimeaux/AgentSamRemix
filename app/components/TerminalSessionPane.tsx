/**
 * Single PTY session (WebSocket + xterm) — used by XTermShell for primary + optional split pane.
 * Each pane uses a distinct `pty_slot` → separate AgentChat DO → independent ExecOS session.
 *
 * Implementation peeled into `./terminal/*` (types, formatters, utils, usePtyWebsocket).
 */
import React, {
  useEffect, useRef, useImperativeHandle, useState, useCallback,
  forwardRef,
} from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  type TerminalConnectionStatus,
  type TerminalSessionPaneHandle,
  type TerminalSessionPaneProps,
} from './terminal/terminalSessionTypes';
import {
  formatAgentsamModelsToTerminal,
  formatAgentsamSdkBootstrapToTerminal,
  agentsamSdkBootstrapCommands,
  isAgentsamModelsSlashLine,
} from './terminal/ptyAssistFormatters';
import {
  focusXtermSurface,
  fitTerminalDimensions,
  isNarrowViewport,
  normalizePtyEnterInput,
  paneHasNativeSelection,
  bindIosNativeTerminalGestures,
  prepareXtermHelperForIos,
  pasteTextIntoXterm,
  readTerminalTheme,
} from './terminal/ptyXtermUtils';
import {
  IOS_TERMINAL_LONG_PRESS_MS,
  pointerHitHelperTextarea,
  clipboardReadFailureReason,
  normalizeClipboardPasteText,
  isPromptPasteZone,
  isTerminalScrolledToBottom,
  shouldPasteOnHoldRelease,
} from './terminal/iosNativeClipboard.mjs';
import { usePtyWebsocket } from './terminal/usePtyWebsocket';

export type { TerminalConnectionStatus, TerminalSessionPaneHandle, TerminalSessionPaneProps };
export {
  formatAgentsamModelsToTerminal,
  formatAgentsamSdkBootstrapToTerminal,
  agentsamSdkBootstrapCommands,
};

export const TerminalSessionPane = forwardRef<TerminalSessionPaneHandle, TerminalSessionPaneProps>(
  (
    {
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
    },
    ref,
  ) => {
    const paneRootRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const pasteAreaRef = useRef<HTMLTextAreaElement>(null);
    const [pasteSheetOpen, setPasteSheetOpen] = useState(false);
    const pasteFromClipboardRef = useRef<() => Promise<{ ok: boolean; reason?: string }>>(
      async () => ({ ok: false, reason: 'no_term' }),
    );

    const {
      status,
      setStatus,
      setSessionIdState,
      socketRef,
      ptySessionIdRef,
      intentionalCloseRef,
      retryCountRef,
      refreshBootstrapRef,
      activeConnectRef,
      reconnectClean,
      disconnectQuiet,
      appendBuffer,
      handlePromptData,
      promptSessionRef,
    } = usePtyWebsocket({
      workspaceId,
      targetType,
      hostedConnectionId,
      ptySlot,
      shell,
      visible,
      connectEnabled,
      onConnectionChange,
      onSessionIdChange,
      onBindingChange,
      onTerminalOutputLine,
      onHardFailure,
      onTunnelHealth,
      xtermRef,
      fitAddonRef,
      terminalRef,
    });

    useEffect(() => {
      const observer = new MutationObserver(() => {
        const term = xtermRef.current;
        if (!term) return;
        const s = getComputedStyle(document.documentElement);
        const bg = s.getPropertyValue('--terminal-surface').trim() || '#060e14';
        const fg = s.getPropertyValue('--text-main').trim() || '#839496';
        const cur = s.getPropertyValue('--solar-cyan').trim() || '#2dd4bf';
        term.options.theme = {
          ...term.options.theme,
          background: bg,
          foreground: fg,
          cursor: cur,
          selectionBackground: 'rgba(45, 212, 191, 0.30)',
          selectionForeground: fg,
        };
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'class', 'style'],
      });
      return () => observer.disconnect();
    }, []);

    const pasteFromClipboard = useCallback(async () => {
      const term = xtermRef.current;
      if (!term) return { ok: false, reason: 'no_term' };
      const clip = navigator.clipboard;
      if (!clip?.readText) {
        setPasteSheetOpen(true);
        return { ok: false, reason: 'clipboard_api' };
      }
      try {
        const text = normalizeClipboardPasteText(await clip.readText());
        if (!text) {
          setPasteSheetOpen(true);
          return { ok: false, reason: 'empty' };
        }
        if (!pasteTextIntoXterm(term, text)) {
          setPasteSheetOpen(true);
          return { ok: false, reason: 'no_term' };
        }
        return { ok: true };
      } catch (err) {
        setPasteSheetOpen(true);
        return { ok: false, reason: clipboardReadFailureReason(err) };
      }
    }, []);
    pasteFromClipboardRef.current = pasteFromClipboard;

    useImperativeHandle(ref, () => ({
      writeToTerminal: (text: string) => {
        xtermRef.current?.writeln(`\r\n\x1b[2m${text}\x1b[0m`);
      },
      writeAnsi: (text: string) => {
        xtermRef.current?.write(text);
      },
      runCommand: (cmd: string) => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(cmd + '\r');
          return;
        }
        const sid = ptySessionIdRef.current;
        xtermRef.current?.writeln('\r\n\x1b[33m  WS offline — POST /api/agent/terminal/run…\x1b[0m');
        void fetch('/api/agent/terminal/run', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ command: cmd, session_id: sid }),
        })
          .then(async (r) => {
            const j = (await r.json().catch(() => ({}))) as {
              error?: string;
              output?: string;
              command?: string;
              execution_id?: string;
            };
            const term = xtermRef.current;
            if (!term) return;
            if (!r.ok) {
              term.writeln(`\r\n\x1b[1;31m  terminal/run ${r.status}: ${j.error ?? 'error'}\x1b[0m`);
              return;
            }
            term.writeln(`\r\n\x1b[36m  $ ${j.command ?? cmd}\x1b[0m`);
            const out = j.output ?? '';
            appendBuffer(out);
            term.writeln(out.trim() !== '' ? out : '  (no output)');
            if (j.execution_id) {
              void fetch('/api/agent/terminal/complete', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  execution_id: j.execution_id,
                  status: 'completed',
                  output_text: out,
                  exit_code: 0,
                }),
              }).catch(() => {});
            }
          })
          .catch(() => xtermRef.current?.writeln('\r\n\x1b[1;31m  terminal/run: network error\x1b[0m'));
      },
      reconnectClean,
      disconnectQuiet,
      getSessionId: () => ptySessionIdRef.current,
      pasteFromClipboard,
      promptLine: (label, opts) => {
        const term = xtermRef.current;
        if (!term) return Promise.resolve(null);
        if (promptSessionRef.current) {
          promptSessionRef.current.resolve(null);
          promptSessionRef.current = null;
        }
        return new Promise((resolve) => {
          promptSessionRef.current = {
            buffer: '',
            resolve,
            mask: opts?.mask,
            defaultValue: opts?.defaultValue,
          };
          term.write(`\r\n${label} `);
          focusXtermSurface(term, terminalRef.current);
        });
      },
    }));

    useEffect(() => {
      if (!pasteSheetOpen) return;
      pasteAreaRef.current?.focus({ preventScroll: true });
    }, [pasteSheetOpen]);

    useEffect(() => {
      if (!terminalRef.current || !visible) return;

      const { background: bg, foreground: fg, cursor: cur } = readTerminalTheme();

      const term = new Terminal({
        theme: {
          background: bg,
          foreground: fg,
          cursor: cur,
          selectionBackground: 'rgba(45, 212, 191, 0.30)',
          selectionForeground: fg,
          black: '#002b36',
          brightBlack: '#657b83',
          red: '#dc322f',
          brightRed: '#cb4b16',
          green: '#859900',
          brightGreen: '#586e75',
          yellow: '#b58900',
          brightYellow: '#657b83',
          blue: '#268bd2',
          brightBlue: '#839496',
          magenta: '#d33682',
          brightMagenta: '#6c71c4',
          cyan: '#2aa198',
          brightCyan: '#93a1a1',
          white: '#eee8d5',
          brightWhite: '#fdf6e3',
        },
        fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, Monaco, "Courier New", monospace',
        fontSize: 12,
        lineHeight: 1.45,
        cursorBlink: true,
        cursorStyle: 'block',
        allowTransparency: true,
        scrollback: 5000,
      });

      const hostEl = terminalRef.current;
      term.open(hostEl);
      const unbindIosGestures = bindIosNativeTerminalGestures(term);
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      fitTerminalDimensions(term, fitAddon, hostEl);

      term.attachCustomKeyEventHandler((event) => {
        const mod = event.metaKey || event.ctrlKey;
        if (!mod || event.altKey) return true;
        const key = event.key.toLowerCase();
        if (key !== 'c' || event.shiftKey) return true;
        const sel = term.getSelection();
        if (!sel?.length) return true;
        event.preventDefault();
        void navigator.clipboard?.writeText(sel).catch(() => {
          /* fallback: xterm may still copy on some browsers */
        });
        return false;
      });

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      let refitTimer: number | null = null;
      const refit = () => {
        // Coalesce ResizeObserver + window resize; remote PTY gets SIGWINCH per dim change.
        if (refitTimer != null) window.clearTimeout(refitTimer);
        refitTimer = window.setTimeout(() => {
          refitTimer = null;
          requestAnimationFrame(() => {
            const t = xtermRef.current;
            const f = fitAddonRef.current;
            if (t && f) fitTerminalDimensions(t, f, terminalRef.current);
          });
        }, 80);
      };
      window.addEventListener('resize', refit);
      const ro = new ResizeObserver(refit);
      ro.observe(hostEl);

      const keyboardTimers: number[] = [];
      /** Soft-keyboard ↵ → ensure xterm emits Enter even if the helper soft-newlines. */
      const onHelperKeyDown = (event: Event) => {
        const e = event as KeyboardEvent;
        if (e.key !== 'Enter' && e.keyCode !== 13) return;
        if (e.shiftKey || e.isComposing || e.altKey || e.metaKey || e.ctrlKey) return;
        // Let xterm's default path run; onData normalizes \n → \r for PTY submit.
        // Do not preventDefault — that would swallow Return on some iOS builds.
      };
      /** Narrow / soft-keyboard viewport: lift chrome + single coalesced fit (remote PTY). */
      const syncSoftKeyboardViewport = () => {
        if (!isNarrowViewport()) return;
        const root = paneRootRef.current;
        const helper = hostEl.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;
        if (!root) return;
        if (helper) {
          prepareXtermHelperForIos(helper);
          helper.style.fontSize = '16px'; // prevent iOS focus zoom
          helper.removeEventListener('keydown', onHelperKeyDown);
          helper.addEventListener('keydown', onHelperKeyDown);
        }
        const focused = !!(helper && document.activeElement === helper);
        // Shell lifts against visualViewport (DOM-only in XTermShell).
        // Do NOT scrollIntoView — on iOS that dismisses the soft keyboard.
        root.style.paddingBottom = focused ? '8px' : '0px';
        refit();
        if (focused) {
          requestAnimationFrame(() => {
            if (xtermRef.current) xtermRef.current.scrollToBottom();
          });
        }
      };
      const onSoftKeyboardFocusIn = () => {
        syncSoftKeyboardViewport();
        keyboardTimers.push(
          window.setTimeout(syncSoftKeyboardViewport, 120),
          window.setTimeout(syncSoftKeyboardViewport, 320),
        );
      };
      const onSoftKeyboardFocusOut = () => {
        for (const id of keyboardTimers.splice(0)) window.clearTimeout(id);
        syncSoftKeyboardViewport();
      };
      const vv = window.visualViewport;
      vv?.addEventListener('resize', syncSoftKeyboardViewport);
      vv?.addEventListener('scroll', syncSoftKeyboardViewport);
      hostEl.addEventListener('focusin', onSoftKeyboardFocusIn);
      hostEl.addEventListener('focusout', onSoftKeyboardFocusOut);

      const syncTheme = () => {
        const next = readTerminalTheme();
        term.options.theme = {
          ...(term.options.theme || {}),
          background: next.background,
          foreground: next.foreground,
          cursor: next.cursor,
          selectionForeground: next.foreground,
        };
      };
      const themeObserver = new MutationObserver(syncTheme);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['style', 'data-cms-theme', 'data-dashboard-theme-ready'],
      });

      const slashModelsSub = term.onData((data) => {
        const payload = normalizePtyEnterInput(data);
        if (handlePromptData(term, payload)) return;
        if (!payload.endsWith('\r')) return;
        const cmd = payload.replace(/\r+$/, '').trim();
        if (isAgentsamModelsSlashLine(cmd)) {
          void formatAgentsamModelsToTerminal((text) => term.write(text));
        }
      });

      return () => {
        unbindIosGestures();
        slashModelsSub.dispose();
        window.removeEventListener('resize', refit);
        if (refitTimer != null) window.clearTimeout(refitTimer);
        vv?.removeEventListener('resize', syncSoftKeyboardViewport);
        vv?.removeEventListener('scroll', syncSoftKeyboardViewport);
        hostEl.removeEventListener('focusin', onSoftKeyboardFocusIn);
        hostEl.removeEventListener('focusout', onSoftKeyboardFocusOut);
        const helper = hostEl.querySelector('.xterm-helper-textarea');
        helper?.removeEventListener('keydown', onHelperKeyDown);
        for (const id of keyboardTimers.splice(0)) window.clearTimeout(id);
        themeObserver.disconnect();
        if (paneRootRef.current) {
          paneRootRef.current.style.paddingBottom = '0px';
        }
        ro.disconnect();
        term.dispose();
        xtermRef.current = null;
        fitAddonRef.current = null;
      };
    }, [visible, handlePromptData]);

    return (
      <>
        <style>{`
          .iam-terminal-pane-root .xterm {
            padding: 0;
            margin: 0;
            height: 100%;
          }
          .iam-terminal-pane-root .xterm-viewport {
            height: 100% !important;
          }
          /* Do not force .xterm-screen to width:100% — that stretches the cell
             canvas vs cols*cellW and crops glyphs / selection on phone. */
          .iam-terminal-pane-root .xterm-shell-viewport .xterm-viewport { overflow-y: auto !important; }
        `}</style>
        <div
          ref={paneRootRef}
          className="iam-terminal-pane-root relative flex-1 min-h-0 min-w-0 flex h-full w-full flex-col bg-[var(--terminal-surface)] overflow-hidden transition-[padding] duration-150"
          onPointerDown={(e) => {
            if (!isNarrowViewport()) return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            const term = xtermRef.current;
            const host = terminalRef.current;
            if (!term || !host) return;

            // Tap = keypad. Hold the prompt line, then lift = paste (user gesture).
            // Hold in scrollback = Safari Copy. No keyboard clipboard chip.
            const start = Date.now();
            const startX = e.clientX;
            const startY = e.clientY;
            let moved = false;
            const atBottom = isTerminalScrolledToBottom(host);
            const inPromptZone = atBottom && isPromptPasteZone(host, startY);
            const target = e.currentTarget;
            const helper = host.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;
            const startOnHelper = pointerHitHelperTextarea(e.target, helper);
            const ac = new AbortController();
            let holdTimer: number | null = null;
            if (inPromptZone) {
              e.preventDefault();
            }
            holdTimer = window.setTimeout(() => {
              if (moved) return;
              if (paneHasNativeSelection(target)) {
                if (!startOnHelper && helper && document.activeElement === helper) {
                  helper.blur();
                }
              }
            }, IOS_TERMINAL_LONG_PRESS_MS);
            const finish = (ev: Event) => {
              if (holdTimer != null) window.clearTimeout(holdTimer);
              ac.abort();
              if (ev.type !== 'pointerup' || moved) return;
              const pe = ev as PointerEvent;
              const heldMs = Date.now() - start;
              if (Math.hypot(pe.clientX - startX, pe.clientY - startY) > 14) return;
              if (shouldPasteOnHoldRelease({
                inPromptZone,
                atBottom,
                moved: false,
                heldMs,
                hasSelection: paneHasNativeSelection(target),
              })) {
                void pasteFromClipboardRef.current();
                return;
              }
              if (heldMs >= IOS_TERMINAL_LONG_PRESS_MS) return;
              if (paneHasNativeSelection(target)) {
                window.getSelection()?.removeAllRanges();
              }
              focusXtermSurface(term, host, { clientX: pe.clientX, clientY: pe.clientY });
              window.setTimeout(() => {
                xtermRef.current?.scrollToBottom();
              }, 320);
            };
            const move = (ev: Event) => {
              const pe = ev as PointerEvent;
              if (Math.hypot(pe.clientX - startX, pe.clientY - startY) > 14) {
                moved = true;
              }
            };
            target.addEventListener('pointermove', move, { signal: ac.signal });
            target.addEventListener('pointerup', finish, { signal: ac.signal });
            target.addEventListener('pointercancel', finish, { signal: ac.signal });
          }}
        >
          {status === 'timed_out' && (
            <div className="absolute inset-0 z-[25] flex flex-col items-center justify-center gap-3 bg-[var(--terminal-surface)]/95 backdrop-blur-sm px-4 text-center">
              <p className="text-[12px] font-mono text-main">
                Session timed out after 5 minutes of inactivity.
              </p>
              <button
                type="button"
                className="px-4 py-2 rounded text-[11px] font-mono border border-[var(--solar-cyan)]/40 text-[var(--solar-cyan)] hover:bg-[var(--solar-cyan)]/10"
                onClick={() => {
                  intentionalCloseRef.current = false;
                  retryCountRef.current = 0;
                  setStatus('connecting');
                  void refreshBootstrapRef.current().finally(() => activeConnectRef.current());
                }}
              >
                Reconnect
              </button>
            </div>
          )}
          <div
            ref={terminalRef}
            className="xterm-shell-viewport min-h-0 min-w-0 flex-1 w-full"
            style={{ padding: 0, margin: 0, height: '100%', minHeight: 0 }}
          />
          {pasteSheetOpen && (
            <div className="iam-terminal-paste-sheet absolute inset-0 z-[40] flex flex-col bg-[var(--terminal-surface)]/96 px-3 py-3 gap-2">
              <p className="text-[11px] font-mono text-main">
                Hold the prompt line to paste. If Safari blocks that, paste here then Insert.
              </p>
              <textarea
                ref={pasteAreaRef}
                className="iam-terminal-paste-sheet-input flex-1 min-h-[72px] w-full rounded border border-[var(--dashboard-border)] bg-[var(--bg-panel)] px-2 py-2 text-[16px] font-mono text-main"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Paste command"
                onPaste={(e) => {
                  const text = normalizeClipboardPasteText(e.clipboardData?.getData('text'));
                  if (!text) return;
                  e.preventDefault();
                  if (pasteTextIntoXterm(xtermRef.current, text)) {
                    setPasteSheetOpen(false);
                  }
                }}
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded text-[11px] font-mono border border-[var(--dashboard-border)] text-muted"
                  onClick={() => setPasteSheetOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded text-[11px] font-mono border border-[var(--solar-cyan)]/40 text-[var(--solar-cyan)]"
                  onClick={() => {
                    const text = normalizeClipboardPasteText(pasteAreaRef.current?.value);
                    if (!text) return;
                    if (pasteTextIntoXterm(xtermRef.current, text)) {
                      setPasteSheetOpen(false);
                    }
                  }}
                >
                  Insert
                </button>
              </div>
            </div>
          )}
        </div>
      </>
    );
  },
);

TerminalSessionPane.displayName = 'TerminalSessionPane';

