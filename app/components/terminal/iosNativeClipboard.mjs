/**
 * Phone Terminal copy/paste predicates.
 * Tap = keypad. Hold the prompt line, then lift = paste (user-gesture).
 * Hold higher in scrollback = Safari Copy. No keyboard clipboard chip.
 */

/**
 * @param {Selection | null} sel
 * @param {Node | null} root
 * @returns {boolean}
 */
export function selectionIsInsidePane(sel, root) {
  if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  const node = sel.anchorNode;
  if (!node) return false;
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !!el && root.contains(el);
}

/**
 * @param {*} target
 * @param {*} helper
 */
export function pointerHitHelperTextarea(target, helper) {
  if (!helper || target == null) return false;
  if (target === helper) return true;
  return typeof Node !== 'undefined' && target instanceof Node && helper.contains(target);
}

/** Long-press (ms) — skip tap-to-focus so Safari can native-select in scrollback. */
export const IOS_TERMINAL_LONG_PRESS_MS = 420;

/** Bottom of the visible PTY — where the prompt sits after scroll-to-bottom. */
export const PROMPT_PASTE_ZONE_PX = 72;

/**
 * @param {{ getBoundingClientRect: () => { bottom: number, height: number } } | null | undefined} host
 * @param {number} clientY
 * @param {number} [zonePx]
 */
export function isPromptPasteZone(host, clientY, zonePx = PROMPT_PASTE_ZONE_PX) {
  if (!host || typeof clientY !== 'number' || Number.isNaN(clientY)) return false;
  const rect = host.getBoundingClientRect();
  if (!(rect.height > 0)) return false;
  const fromBottom = rect.bottom - clientY;
  return fromBottom >= 0 && fromBottom <= zonePx;
}

/**
 * Hold-to-paste is armed on the timer; clipboard read must run on pointerup
 * so iOS still treats it as a user gesture.
 * @param {{ inPromptZone: boolean, atBottom: boolean, moved: boolean, heldMs: number, hasSelection: boolean }} s
 */
export function shouldPasteOnHoldRelease(s) {
  return !!(
    s.inPromptZone &&
    s.atBottom &&
    !s.moved &&
    s.heldMs >= IOS_TERMINAL_LONG_PRESS_MS &&
    !s.hasSelection
  );
}

/**
 * Prompt-line paste only when the viewport is pinned to the live prompt.
 * Scrolled-up history stays Safari Copy.
 * @param {{ querySelector?: (sel: string) => { scrollHeight: number, scrollTop: number, clientHeight: number } | null } | null | undefined} host
 * @param {number} [slopPx]
 */
export function isTerminalScrolledToBottom(host, slopPx = 8) {
  const vp = host?.querySelector?.('.xterm-viewport');
  if (!vp) return true;
  return vp.scrollHeight - vp.scrollTop - vp.clientHeight <= slopPx;
}

/**
 * Place the helper as a full-width strip under the tap so the keypad can open.
 * @param {*} host
 * @param {{ clientX: number, clientY: number }} at
 */
export function helperStyleUnderClientPoint(host, at) {
  const screen = host.querySelector('.xterm-screen') || host;
  const pos = screen.getBoundingClientRect();
  return {
    left: '0px',
    top: `${Math.max(0, at.clientY - pos.top - 22)}px`,
    width: '100%',
  };
}

/**
 * @param {unknown} err
 * @returns {'denied' | 'empty' | 'clipboard_api' | 'failed'}
 */
export function clipboardReadFailureReason(err) {
  if (err == null) return 'failed';
  const name = typeof err === 'object' && err && 'name' in err ? String(err.name) : '';
  if (name === 'NotAllowedError' || name === 'NotFoundError' || name === 'SecurityError') {
    return 'denied';
  }
  return 'failed';
}

/**
 * @param {string | null | undefined} text
 * @returns {string}
 */
export function normalizeClipboardPasteText(text) {
  return String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
