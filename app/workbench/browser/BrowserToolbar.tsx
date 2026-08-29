/** @license SPDX-License-Identifier: Apache-2.0 */
import React from 'react';
import {
  RotateCcw, Copy, Columns2, X, CheckCircle, Camera, MoreHorizontal,
  MousePointer2, PenLine, ZoomIn, ZoomOut, Trash2, Cookie, HardDrive, Bug,
} from 'lucide-react';
import type { PaneMode, ViewSurface } from './types.ts';

const ToolBtn: React.FC<{
  icon:      React.ReactNode;
  title:     string;
  active?:   boolean;
  danger?:   boolean;
  disabled?: boolean;
  onClick:   () => void;
}> = ({ icon, title, active, danger, disabled, onClick }) => (
  <button
    type="button"
    title={title}
    disabled={disabled}
    onClick={onClick}
    className={`p-1.5 rounded transition-all shrink-0 ${
      active
        ? 'text-[var(--color-primary)] bg-[var(--color-primary)]/10 shadow-[0_0_8px_rgba(58,159,232,0.3)]'
        : danger
          ? 'text-muted hover:text-red-400 hover:bg-red-500/10'
          : 'text-muted hover:text-main hover:bg-[var(--bg-hover)]'
    } disabled:opacity-30 disabled:cursor-default`}
  >
    {icon}
  </button>
);

export type BrowserToolbarProps = {
  label?: 'A' | 'B';
  viewSurface: ViewSurface;
  liveSessionReady: boolean;
  liveUrlPending: string | null;
  liveUrlCommitted: string | null;
  inputVal: string;
  setInputVal: (v: string) => void;
  agentActive: boolean;
  designModeOn: boolean;
  mode: PaneMode;
  devToolsOpen: boolean;
  menuOpen: boolean;
  copied: boolean;
  zoom: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onNavigateEnter: () => void;
  onHardReload: () => void;
  onSplit?: (url: string) => void;
  isSplit?: boolean;
  currentUrl: string;
  onClose?: () => void;
  toggleDesignMode: () => void;
  onPickerToggle: () => void;
  onAnnotate: () => void;
  onDevTools: () => void;
  setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  runScreenshot: () => void;
  toggleMode: (m: PaneMode) => void;
  copyUrl: () => void | Promise<void>;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  clearBrowserData: (what: 'history' | 'cookies' | 'cache') => void;
};

export function BrowserToolbar(p: BrowserToolbarProps) {
  const {
    label, viewSurface, liveSessionReady, liveUrlPending, liveUrlCommitted,
    inputVal, setInputVal, agentActive, designModeOn, mode, devToolsOpen,
    menuOpen, copied, zoom, inputRef, menuRef, onNavigateEnter, onHardReload,
    onSplit, isSplit, currentUrl, onClose, toggleDesignMode, onPickerToggle,
    onAnnotate, onDevTools, setMenuOpen, runScreenshot, toggleMode, copyUrl,
    setZoom, clearBrowserData,
  } = p;

  return (
      <div className="flex items-center gap-1 px-2 py-1 bg-[var(--bg-panel)] border-b border-[var(--border-subtle)] shrink-0 min-w-0">

        {label && (
          <span className="shrink-0 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-muted">
            {label}
          </span>
        )}

        <ToolBtn
          icon={<RotateCcw size={12} strokeWidth={1.75} />}
          title="Reload"
          onClick={onHardReload}
        />

        <input
          ref={inputRef}
          type="text"
          value={
            viewSurface === 'live'
              ? liveUrlCommitted || (liveSessionReady ? inputVal : '')
              : inputVal
          }
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => { if (e.key !== 'Enter') return; onNavigateEnter(); }}
          placeholder={
            viewSurface === 'live' && !liveSessionReady
              ? 'Starting live browser…'
              : 'https://'
          }
          readOnly={viewSurface === 'live' && agentActive}
          spellCheck={false}
          aria-label="URL"
          className={`flex-1 min-w-0 h-6 px-2 text-[11px] rounded border border-[var(--border-subtle)] bg-[var(--bg-app)] focus:outline-none focus:border-[var(--color-primary)] font-mono text-main placeholder:text-muted ${
            viewSurface === 'live' && agentActive ? 'opacity-90 cursor-default' : ''
          }`}
        />
        {viewSurface === 'live' && liveUrlPending && liveUrlPending !== liveUrlCommitted ? (
          <span className="shrink-0 text-[9px] font-mono text-amber-400/90 max-w-[28%] truncate" title={liveUrlPending}>
            → {liveUrlPending.replace(/^https?:\/\//, '')}
          </span>
        ) : null}

        {onSplit && !isSplit && (
          <ToolBtn
            icon={<Columns2 size={12} strokeWidth={1.75} />}
            title="Split pane"
            onClick={() => onSplit(currentUrl)}
          />
        )}

        {/* Design Mode — Cmd+Shift+D (does not change composer mode) */}
        <ToolBtn
          icon={<PenLine size={12} strokeWidth={1.75} />}
          title="Design Mode (Cmd+Shift+D) — pick/draw; Agent keeps mode"
          active={designModeOn}
          onClick={() => toggleDesignMode()}
        />

        {/* Element Picker — opt-in; does not stay forced when Design Mode is armed */}
        <ToolBtn
          icon={<MousePointer2 size={12} strokeWidth={1.75} />}
          title={
            designModeOn
              ? mode === 'picker'
                ? 'Exit pick (Esc) — keep Design Mode armed'
                : 'Pick elements for Agent (Design Mode armed)'
              : 'Element picker — hover to highlight, click to inspect'
          }
          active={mode === 'picker'}
          onClick={onPickerToggle}
        />

        {designModeOn ? (
          <ToolBtn
            icon={<Camera size={12} strokeWidth={1.75} />}
            title="Annotate — draw on frozen viewport"
            active={mode === 'annotate'}
            onClick={onAnnotate}
          />
        ) : null}

        {/* DevTools */}
        <ToolBtn
          icon={<Bug size={12} strokeWidth={1.75} />}
          title="DevTools — real Chromium inspector (Browser Run)"
          active={devToolsOpen}
          onClick={onDevTools}
        />

        {/* ... menu */}
        <div className="relative shrink-0" ref={menuRef}>
          <ToolBtn
            icon={<MoreHorizontal size={12} strokeWidth={1.75} />}
            title="More options"
            active={menuOpen}
            onClick={() => setMenuOpen(v => !v)}
          />
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-52 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated,var(--bg-panel))] shadow-2xl py-1.5 z-[9999] overflow-hidden">

              <button type="button" onClick={() => { setMenuOpen(false); runScreenshot(); }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px] text-main hover:bg-[var(--bg-hover)] transition-colors text-left">
                <Camera size={12} className="text-muted shrink-0" /> Take Screenshot
              </button>

              <button type="button" onClick={() => { setMenuOpen(false); toggleMode('area'); }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px] text-main hover:bg-[var(--bg-hover)] transition-colors text-left">
                <Camera size={12} className="text-muted shrink-0" /> Capture Area Screenshot
              </button>

              <div className="h-px bg-[var(--border-subtle)] my-1" />

              <button type="button" onClick={onHardReload}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px] text-main hover:bg-[var(--bg-hover)] transition-colors text-left">
                <RotateCcw size={12} className="text-muted shrink-0" /> Hard Reload
              </button>

              <button type="button" onClick={copyUrl}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px] text-main hover:bg-[var(--bg-hover)] transition-colors text-left">
                {copied ? <CheckCircle size={12} className="text-green-400 shrink-0" /> : <Copy size={12} className="text-muted shrink-0" />}
                {copied ? 'Copied!' : 'Copy Current URL'}
              </button>

              <div className="h-px bg-[var(--border-subtle)] my-1" />

              {/* Zoom */}
              <div className="flex items-center gap-2 px-3 py-1.5">
                <button type="button" onClick={() => setZoom(z => Math.max(25, z - 25))}
                  className="p-0.5 rounded text-muted hover:text-main hover:bg-[var(--bg-hover)] transition-colors">
                  <ZoomOut size={12} />
                </button>
                <span className="flex-1 text-center text-[11px] font-mono text-main">{zoom}%</span>
                <button type="button" onClick={() => setZoom(z => Math.min(200, z + 25))}
                  className="p-0.5 rounded text-muted hover:text-main hover:bg-[var(--bg-hover)] transition-colors">
                  <ZoomIn size={12} />
                </button>
              </div>

              <div className="h-px bg-[var(--border-subtle)] my-1" />

              <button type="button" onClick={() => clearBrowserData('history')}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px] text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors text-left">
                <Trash2 size={12} className="shrink-0" /> Clear Browsing History
              </button>
              <button type="button" onClick={() => clearBrowserData('cookies')}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px] text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors text-left">
                <Cookie size={12} className="shrink-0" /> Clear Cookies
              </button>
              <button type="button" onClick={() => clearBrowserData('cache')}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px] text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors text-left">
                <HardDrive size={12} className="shrink-0" /> Clear Cache
              </button>

              {onClose && (
                <>
                  <div className="h-px bg-[var(--border-subtle)] my-1" />
                  <button type="button" onClick={() => { onClose(); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px] text-red-400 hover:bg-red-500/10 transition-colors text-left">
                    <X size={12} className="shrink-0" /> Close Pane
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {onClose && (
          <ToolBtn icon={<X size={12} strokeWidth={1.75} />} title="Close pane" danger onClick={onClose} />
        )}
      </div>
  );
}
