/** @license SPDX-License-Identifier: Apache-2.0 */
import React from 'react';
import { Camera, X, Bug } from 'lucide-react';
import { applyBrowserRunLiveViewMode } from './browserLiveViewUrl.ts';
import { IAM_LOGO } from './types.ts';

export const BlockedPage: React.FC<{ url: string; onScreenshot: () => void }> = ({ url, onScreenshot }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-[var(--bg-app)] z-10 min-h-0 w-full">
    <img
      src={IAM_LOGO}
      alt="Inner Animal Media"
      className="w-14 h-14 rounded-xl opacity-60"
      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
    />
    <div className="text-center">
      <p className="text-[11px] font-bold uppercase tracking-widest text-muted mb-1">
        Page cannot be embedded
      </p>
      <p className="text-[10px] font-mono text-muted/60 max-w-[200px] break-all">{url}</p>
    </div>
    <button
      type="button"
      onClick={onScreenshot}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20 text-[var(--color-primary)] text-[11px] font-semibold hover:bg-[var(--color-primary)]/20 transition-colors"
    >
      <Camera size={12} />
      View via Playwright
    </button>
  </div>
);

export function resolveBrowserRunEmbedUrls(baseUrl: string | null | undefined): {
  tab: string;
  devtools: string;
} | null {
  const raw = String(baseUrl || '').trim();
  if (!raw) return null;
  return {
    tab: applyBrowserRunLiveViewMode(raw, 'tab'),
    devtools: applyBrowserRunLiveViewMode(raw, 'devtools'),
  };
}

export const BrowserSurfaceDevToolsDock: React.FC<{
  devtoolsEmbedUrl: string;
  sessionId: string | null;
  widthPct: number;
  onClose: () => void;
  onResizeStart: (e: React.MouseEvent) => void;
}> = ({ devtoolsEmbedUrl, sessionId, widthPct, onClose, onResizeStart }) => (
  <>
    <div
      className="w-1 bg-[var(--border-subtle)] cursor-col-resize shrink-0 hover:bg-[var(--color-primary)] transition-colors"
      onMouseDown={onResizeStart}
      role="separator"
      aria-orientation="vertical"
    />
    <div
      className="flex flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-elevated,var(--bg-panel))] overflow-hidden min-h-0 min-w-0"
      style={{ width: `${widthPct}%`, minWidth: 280, maxWidth: '70%' }}
    >
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--border-subtle)] shrink-0">
        <Bug size={12} className="text-[var(--color-primary)] shrink-0" />
        <span className="text-[10px] font-mono uppercase tracking-widest text-main">DevTools</span>
        {sessionId ? (
          <span className="text-[9px] font-mono text-muted truncate" title={sessionId}>
            session {sessionId}
          </span>
        ) : null}
        <div className="flex-1" />
        <button type="button" onClick={onClose} className="p-1 text-muted hover:text-red-400 hover:bg-red-500/10 rounded">
          <X size={11} />
        </button>
      </div>
      <iframe
        key={devtoolsEmbedUrl}
        src={devtoolsEmbedUrl}
        title="Browser Run DevTools"
        allow="clipboard-read; clipboard-write; fullscreen"
        className="flex-1 min-h-0 w-full border-0 bg-[var(--bg-app)]"
      />
    </div>
  </>
);
