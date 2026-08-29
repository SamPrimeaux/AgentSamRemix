/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CSSProperties } from 'react';

/** Matches App.tsx `buildAgentSamGreeting` — hide this bubble when no real thread content yet. */
export function isAgentSamEmptyThreadGreeting(content: string): boolean {
  const t = content.trim();
  return t.startsWith("Hi! I'm Agent Sam.") || t.startsWith('Agent Sam: pick a workspace');
}

export function formatFileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Portal menu position: clamp horizontal (16px inset), prefer above anchor, else below.
 * @param menuWidthForClamp — use for `left` clamp (e.g. slash menu max-w 320); defaults to minW.
 */
export function measureAboveAnchor(
  el: HTMLElement | null,
  minW: number,
  maxHeightCap = 280,
  menuWidthForClamp?: number,
): CSSProperties | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const gap = 8;
  const hPad = 16;
  const mw = menuWidthForClamp ?? minW;
  const maxMenuW = Math.max(160, window.innerWidth - 2 * hPad);
  const effClampW = Math.min(mw, maxMenuW);
  const effMinW = Math.min(minW, maxMenuW);
  const left = Math.max(hPad, Math.min(r.left, window.innerWidth - effClampW - hPad));

  const spaceAbove = Math.max(0, r.top - gap - 8);
  const spaceBelow = Math.max(0, window.innerHeight - r.bottom - gap - 8);
  const minMenu = 100;
  const placeAbove = spaceAbove >= minMenu ? true : spaceBelow > spaceAbove ? false : true;

  const sizeStyle: CSSProperties = {
    minWidth: effMinW,
    maxWidth: maxMenuW,
    boxSizing: 'border-box',
    overflowX: 'hidden',
  };

  if (placeAbove) {
    return {
      position: 'fixed',
      left,
      right: 'auto',
      bottom: window.innerHeight - r.top + gap,
      top: 'auto',
      zIndex: 9999,
      maxHeight: Math.min(maxHeightCap, Math.max(64, spaceAbove)),
      ...sizeStyle,
    };
  }

  return {
    position: 'fixed',
    left,
    right: 'auto',
    top: r.bottom + gap,
    bottom: 'auto',
    zIndex: 9999,
    maxHeight: Math.min(maxHeightCap, Math.max(64, spaceBelow)),
    ...sizeStyle,
  };
}

/** Attach menu: prefer below composer; flip above when bottom chrome would clip it. */
export function measureBelowComposerAnchor(
  composerEl: HTMLElement | null,
  maxHeightCap = 480,
): CSSProperties | null {
  if (!composerEl) return null;
  const r = composerEl.getBoundingClientRect();
  const gap = 8;
  const hPad = 16;
  const menuWidth = Math.min(r.width, window.innerWidth - 2 * hPad);
  const left = Math.max(hPad, Math.min(r.left, window.innerWidth - menuWidth - hPad));
  const spaceBelow = Math.max(0, window.innerHeight - r.bottom - gap - 8);
  const spaceAbove = Math.max(0, r.top - gap - 8);
  const minMenu = 120;
  const placeAbove = spaceBelow < minMenu && spaceAbove >= minMenu;

  const sizeStyle: CSSProperties = {
    width: menuWidth,
    boxSizing: 'border-box',
    zIndex: 9999,
    overflowX: 'hidden',
  };

  if (placeAbove) {
    return {
      position: 'fixed',
      left,
      right: 'auto',
      bottom: window.innerHeight - r.top + gap,
      top: 'auto',
      maxHeight: Math.min(maxHeightCap, Math.max(64, spaceAbove)),
      ...sizeStyle,
    };
  }

  return {
    position: 'fixed',
    left,
    top: r.bottom + gap,
    width: menuWidth,
    boxSizing: 'border-box',
    zIndex: 9999,
    maxHeight: Math.min(maxHeightCap, Math.max(64, spaceBelow)),
    overflowX: 'hidden',
  };
}

export function syncComposerTextareaHeight(el: HTMLTextAreaElement | null, maxPx: number) {
  if (!el) return;
  el.style.height = 'auto';
  const sh = el.scrollHeight;
  el.style.height = `${Math.min(sh, maxPx)}px`;
  el.style.overflowY = sh > maxPx ? 'auto' : 'hidden';
}
