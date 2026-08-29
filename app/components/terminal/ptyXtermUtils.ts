/** Pure helpers for xterm host fit, theme, input normalize, output line emit. */
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { PHONE_MQ } from '../../lib/breakpoints';
import { helperStyleUnderClientPoint, selectionIsInsidePane } from './iosNativeClipboard.mjs';

export function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(PHONE_MQ).matches;
}

export function paneHasNativeSelection(root: HTMLElement | null): boolean {
  if (typeof window === 'undefined' || !root) return false;
  return selectionIsInsidePane(window.getSelection(), root);
}

export function prepareXtermHelperForIos(textarea: HTMLTextAreaElement) {
  textarea.setAttribute('inputmode', 'text');
  textarea.setAttribute('enterkeyhint', 'send');
  textarea.setAttribute('autocomplete', 'off');
  textarea.setAttribute('autocorrect', 'off');
  textarea.setAttribute('autocapitalize', 'off');
  textarea.setAttribute('spellcheck', 'false');
}

export function pasteTextIntoXterm(term: Terminal | null, text: string): boolean {
  const payload = text ?? '';
  if (!term || !payload) return false;
  if (typeof term.paste === 'function') {
    term.paste(payload);
    return true;
  }
  return false;
}

export function focusXtermSurface(
  term: Terminal,
  host: HTMLElement | null,
  at?: { clientX: number; clientY: number },
) {
  term.focus();
  const textarea = host?.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;
  if (textarea) {
    prepareXtermHelperForIos(textarea);
    if (at && host) {
      const pos = helperStyleUnderClientPoint(host, at);
      textarea.style.left = pos.left;
      textarea.style.top = pos.top;
      if (pos.width) textarea.style.width = pos.width;
    }
    textarea.focus({ preventScroll: true });
  }
}

/**
 * On phone, stop xterm from owning long-press (teal overlay + contextmenu).
 * Scrollback stays Safari Copy. Prompt-line hold+lift pastes via clipboard.readText.
 */
export function bindIosNativeTerminalGestures(term: Terminal): () => void {
  const el = term.element;
  if (!el || !isNarrowViewport()) return () => {};
  const onMouseDownCapture = (ev: MouseEvent) => {
    const t = ev.target;
    if (t instanceof HTMLElement && t.classList.contains('xterm-helper-textarea')) return;
    ev.stopImmediatePropagation();
  };
  const onContextMenuCapture = (ev: Event) => {
    ev.stopImmediatePropagation();
  };
  el.addEventListener('mousedown', onMouseDownCapture, true);
  el.addEventListener('contextmenu', onContextMenuCapture, true);
  return () => {
    el.removeEventListener('mousedown', onMouseDownCapture, true);
    el.removeEventListener('contextmenu', onContextMenuCapture, true);
  };
}

export function readTerminalTheme() {
  const s = getComputedStyle(document.documentElement);
  return {
    background: s.getPropertyValue('--terminal-surface').trim() || s.getPropertyValue('--dashboard-canvas').trim() || '#060e14',
    foreground: s.getPropertyValue('--dashboard-text').trim() || s.getPropertyValue('--text-main').trim() || '#839496',
    cursor: s.getPropertyValue('--solar-cyan').trim() || '#2dd4bf',
  };
}

/**
 * iOS Return/↵ often emits `\n` (or `\r\n`) from the xterm helper textarea.
 * PTY shells execute on carriage-return — normalize so ↵ = Enter = submit.
 */
export function normalizePtyEnterInput(data: string): string {
  if (data === '\n' || data === '\r\n') return '\r';
  if (data.endsWith('\r\n')) return `${data.slice(0, -2)}\r`;
  if (data.endsWith('\n') && !data.endsWith('\r\n')) return `${data.slice(0, -1)}\r`;
  return data;
}

/**
 * Fit PTY geometry to the host. On narrow viewports, apply a single resize
 * via proposeDimensions (never fit() then a second heuristic resize — double
 * SIGWINCH redraws Local Mac zsh and remote ExecOS PS1 alike).
 */
export function fitTerminalDimensions(
  term: Terminal,
  fitAddon: FitAddon,
  host: HTMLElement | null,
): void {
  if (!host) {
    fitAddon.fit();
    return;
  }
  if (!isNarrowViewport()) {
    fitAddon.fit();
    return;
  }
  // Prefer FitAddon propose only — min(proposed, heuristic-1) left empty right
  // gutters and fought xterm's cell canvas (looked cropped on phone).
  let proposed: { cols: number; rows: number } | undefined;
  try {
    proposed = fitAddon.proposeDimensions() ?? undefined;
  } catch {
    proposed = undefined;
  }
  if (proposed && proposed.cols > 0 && proposed.rows > 0) {
    const cols = Math.max(24, proposed.cols);
    const rows = Math.max(3, proposed.rows);
    if (term.cols !== cols || term.rows !== rows) {
      term.resize(cols, rows);
    }
    return;
  }
  const measure = host.querySelector('.xterm-char-measure-element') as HTMLElement | null;
  const measuredW = measure?.getBoundingClientRect().width ?? 0;
  const measuredH = measure?.getBoundingClientRect().height ?? 0;
  const fontSize = term.options.fontSize ?? 12;
  const lineHeight = term.options.lineHeight ?? 1.45;
  const cellW = measuredW > 4 ? measuredW : Math.max(6.5, fontSize * 0.62);
  const cellH = measuredH > 8 ? measuredH : Math.max(10, fontSize * lineHeight);
  const rect = host.getBoundingClientRect();
  const widthPx = rect.width > 0 ? rect.width : window.innerWidth;
  const heightPx = rect.height > 0 ? rect.height : 200;
  const cols = Math.max(24, Math.floor(widthPx / cellW));
  const rows = Math.max(3, Math.floor(heightPx / cellH));
  if (term.cols !== cols || term.rows !== rows) {
    term.resize(cols, rows);
  }
}

export function isShellHistorySeedLine(line: string): boolean {
  const t = line.replace(/[\r\n]+$/, '').trim();
  if (!t) return true;
  if (/^print\s+-s\b/i.test(t)) return true;
  if (/^history\s+-s\b/i.test(t)) return true;
  if (/^Add-History\b/i.test(t)) return true;
  if (/\x1b\[[0-9;]*200~|\x1b\[[0-9;]*201~|\[200~|\[201~/.test(t)) return true;
  if (t.length > 2000) return true;
  if (/print\s+-s/i.test(t)) return true;
  if ((t.match(/\\'/g) || []).length > 6) return true;
  return false;
}

/** Strip CSI/OSC/control noise before mirroring PTY chunks into the Output tab. */
export function stripTerminalControlSequences(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[\??0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

export function closeSocketQuietly(ws: WebSocket | null) {
  if (!ws) return;
  ws.onopen = null;
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;
  if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
    ws.close(1000, 'superseded');
  }
}

/** Bare zsh/bash prompt crumbs from SIGWINCH redraws — not useful in Output. */
function isPromptOnlySpamLine(line: string): boolean {
  return /^[%$#❯›]+\s*$/.test(line) || /^[^\w]{1,4}$/.test(line);
}

export function emitTerminalOutputLines(
  text: string,
  onLine: ((line: string) => void) | undefined,
  lineBufRef: { current: string },
  lastEmittedRef?: { current: string },
) {
  if (!onLine || !text) return;
  const cleaned = stripTerminalControlSequences(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const combined = lineBufRef.current + cleaned;
  const parts = combined.split('\n');
  lineBufRef.current = parts.pop() ?? '';
  for (const part of parts) {
    const t = part.replace(/\x08/g, '').trim();
    if (!t || isShellHistorySeedLine(t) || isPromptOnlySpamLine(t)) continue;
    if (lastEmittedRef && lastEmittedRef.current === t) continue;
    if (lastEmittedRef) lastEmittedRef.current = t;
    onLine(t.slice(0, 2000));
  }
}
