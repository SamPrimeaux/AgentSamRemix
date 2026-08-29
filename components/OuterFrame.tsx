import React, { useRef, useState, useEffect } from 'react';
import { TokenCount } from '../types';
import {
  AppSettings,
  THEME_PALETTES,
  DEFAULT_APP_SETTINGS,
  loadStoredSettings,
  saveStoredSettings,
  applyThemeToDocument,
} from '../services/themeService';
import { AppSettingsModal } from './AppSettingsModal';

// Smooth interpolated counter — counts up toward target value
const AnimatedNumber: React.FC<{ value: number; prefix?: string; prefixVisible?: boolean; animate?: boolean }> = ({ value, prefix, prefixVisible = true, animate = true }) => {
  const [displayed, setDisplayed] = useState(0);
  const rafRef = useRef<number>(0);
  const currentRef = useRef(0);

  useEffect(() => {
    if (!animate) {
      cancelAnimationFrame(rafRef.current);
      currentRef.current = value;
      setDisplayed(value);
      return;
    }
    const target = value;
    const step = () => {
      const current = currentRef.current;
      const diff = target - current;
      if (Math.abs(diff) < 1) {
        currentRef.current = target;
        setDisplayed(target);
        return;
      }
      currentRef.current = current + diff * 0.15;
      setDisplayed(Math.round(currentRef.current));
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, animate]);

  return (
    <span className="animated-number">
      {prefix && <span className="animated-prefix" style={{ opacity: prefixVisible ? 0.7 : 0 }}>{prefix}</span>}
      {displayed.toLocaleString()}
    </span>
  );
};

// Elapsed timer — starts when isActive becomes true, stops when it becomes false
const ElapsedTimer: React.FC<{ isActive: boolean }> = ({ isActive }) => {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (isActive) {
      startRef.current = Date.now();
      const tick = () => {
        setElapsed((Date.now() - startRef.current) / 1000);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafRef.current);
    } else if (startRef.current > 0) {
      setElapsed((Date.now() - startRef.current) / 1000);
    }
  }, [isActive]);

  return <span>{elapsed.toFixed(2)}s</span>;
};

interface OuterFrameProps {
  children: React.ReactNode;
  tokenCount: TokenCount | null;
  isLoading: boolean;
  appMode?: 'browser' | 'antigravity';
  onAppModeChange?: (mode: 'browser' | 'antigravity') => void;
  onOpenSettings?: () => void;
}

export const OuterFrame: React.FC<OuterFrameProps> = ({
  children,
  tokenCount,
  isLoading,
  appMode = 'browser',
  onAppModeChange,
}) => {
  // Linear zoom: 1.0 at ≤1080px viewport height, 1.5 at 1440px, etc.
  const [zoom, setZoom] = useState(1);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(() => loadStoredSettings());
  const [isMaximized, setIsMaximized] = useState(false);

  // Initialize theme on mount and settings change
  useEffect(() => {
    applyThemeToDocument(settings);
  }, [settings]);

  // Keyboard shortcut: Ctrl+, or Cmd+, to open Settings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setIsSettingsOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const update = () => {
      const vh = window.innerHeight;
      setZoom(Math.max(1, 1 + (vh - 1080) * 0.5 / 360));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const handleUpdateSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    saveStoredSettings(newSettings);
    applyThemeToDocument(newSettings);
  };

  const handleResetSettings = () => {
    setSettings(DEFAULT_APP_SETTINGS);
    saveStoredSettings(DEFAULT_APP_SETTINGS);
    applyThemeToDocument(DEFAULT_APP_SETTINGS);
  };

  // Quick cycle to next theme
  const handleQuickCycleTheme = () => {
    const currentIndex = THEME_PALETTES.findIndex(t => t.id === settings.themeId);
    const nextIndex = (currentIndex + 1) % THEME_PALETTES.length;
    const nextTheme = THEME_PALETTES[nextIndex];
    handleUpdateSettings({
      ...settings,
      themeId: nextTheme.id,
      customAccent: null,
    });
  };

  // Fullscreen support
  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsMaximized(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsMaximized(false);
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      setIsMaximized(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const isOutputPhase = (tokenCount?.output ?? 0) > 0;
  const arrowIcon = isOutputPhase ? 'arrow_downward' : 'arrow_upward';
  const phaseClass = isOutputPhase ? 'token-out' : 'token-in';
  const totalTokens = (tokenCount?.input ?? 0) + (tokenCount?.output ?? 0);
  const currentThemeObj = THEME_PALETTES.find(t => t.id === settings.themeId) || THEME_PALETTES[0];

  return (
    <div
      className={`app-shell-root pattern-${settings.backgroundPattern}`}
      id="agentsam-app-shell"
    >
      {/* Background Texture Overlay */}
      <div className={`canvas-texture-layer pattern-${settings.backgroundPattern}`} aria-hidden="true" />

      {/* Production Top Application Bar */}
      <header className="app-shell-navbar" id="app-shell-topbar">
        {/* Left: Brand Identity & Live Engine Badge */}
        <div className="app-shell-brand-section">
          <div className="app-brand-badge">
            <span className="material-symbols-outlined app-brand-icon" aria-hidden="true">
              terminal
            </span>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="app-brand-name font-bold tracking-tight">AgentSamRemix</span>
                <span className="app-version-pill font-mono">v3.2</span>
              </div>
            </div>
          </div>

          <div className="app-live-status-pill hidden sm:inline-flex" title="Engine connected to Gemini 3.7 Flash & Cloudflare Edge">
            <span className="app-pulse-dot" />
            <span className="text-[11px] font-medium">Gemini 3.7 Flash Live</span>
          </div>
        </div>

        {/* Center: Primary Application Navigation Switcher */}
        {onAppModeChange && (
          <nav className="app-mode-switcher-nav" aria-label="Application View Switcher">
            <button
              type="button"
              id="nav-btn-browser-mode"
              onClick={() => onAppModeChange('browser')}
              className={`app-mode-pill ${appMode === 'browser' ? 'active' : ''}`}
              title="Interactive Web Generation Browser"
            >
              <span className="material-symbols-outlined text-[16px]">language</span>
              <span>Browser Sandbox</span>
            </button>
            <button
              type="button"
              id="nav-btn-antigravity-mode"
              onClick={() => onAppModeChange('antigravity')}
              className={`app-mode-pill ${appMode === 'antigravity' ? 'active' : ''}`}
              title="AgentSam AntiGravity Execution Sandbox & Monaco Workspace"
            >
              <span className="material-symbols-outlined text-[16px] text-sky-400">deployed_code</span>
              <span>AntiGravity Suite</span>
              <span className="app-pill-badge">EXEC</span>
            </button>
          </nav>
        )}

        {/* Right: Telemetry, Theme Swatch & Settings Action Controls */}
        <div className="app-shell-actions-section">
          {/* Live Token Telemetry (during streaming) */}
          {tokenCount && appMode === 'browser' && settings.showLiveTokens && (
            <div className="app-token-badge" aria-live="polite" aria-atomic="true">
              <span className={phaseClass}>
                <span className="material-symbols-outlined text-sm align-middle" aria-hidden="true">
                  {isLoading ? arrowIcon : 'check'}
                </span>
                <AnimatedNumber value={totalTokens} prefix="~" prefixVisible={!!tokenCount.isEstimate} animate={isLoading} />
              </span>
              <span className="text-zinc-500 font-mono text-[11px] ml-1">tokens</span>
              <span className="text-zinc-400 font-mono text-[11px] ml-1.5"><ElapsedTimer isActive={isLoading} /></span>
            </div>
          )}

          {/* Quick Theme Cycler Button */}
          <button
            type="button"
            id="app-theme-quick-btn"
            className="app-tool-btn"
            onClick={handleQuickCycleTheme}
            title={`Current Theme: ${currentThemeObj.name} (Click to switch)`}
          >
            <span
              className="theme-swatch-dot"
              style={{ background: currentThemeObj.previewColors.accent }}
            />
            <span className="hidden md:inline text-xs font-medium">{currentThemeObj.name}</span>
          </button>

          {/* Fullscreen Toggle Button */}
          <button
            type="button"
            id="app-fullscreen-btn"
            className="app-tool-btn icon-only"
            onClick={handleToggleFullscreen}
            title={isMaximized ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            <span className="material-symbols-outlined text-base">
              {isMaximized ? 'fullscreen_exit' : 'fullscreen'}
            </span>
          </button>

          {/* App Settings & Cloudflare Bindings Modal Trigger */}
          <button
            type="button"
            id="app-settings-trigger-btn"
            className="app-settings-primary-btn"
            onClick={() => setIsSettingsOpen(true)}
            title="Open App Settings & Cloudflare Runtime Bindings (Ctrl+,)"
          >
            <span className="material-symbols-outlined text-base">settings</span>
            <span className="text-xs font-semibold">Settings & Bindings</span>
            <kbd className="hidden lg:inline-block ml-1 text-[10px] px-1 py-0.2 bg-black/30 border border-white/10 rounded font-mono">⌘,</kbd>
          </button>
        </div>
      </header>

      {/* Main Full-Viewport Workspace Content */}
      <main className="app-workspace-main" id="app-workspace-canvas">
        {children}
      </main>

      {/* Sleek Integrated Status Bar */}
      <footer className="app-shell-statusbar" id="app-shell-statusbar">
        <div className="statusbar-left">
          <div className="status-item font-medium">
            <span className="status-indicator-dot online" />
            <span>Edge Runtime:</span>
            <strong className="text-zinc-200">
              {appMode === 'antigravity' ? '@cloudflare/think + computer' : 'Gemini 3.7 Flash GenAI'}
            </strong>
          </div>
          <span className="status-sep">|</span>
          <div className="status-item hidden sm:flex text-zinc-400">
            <span>Model:</span>
            <span className="text-sky-400 font-mono">GLM-5.3 / Gemini 3.7</span>
          </div>
          <span className="status-sep hidden md:inline">|</span>
          <div className="status-item hidden md:flex text-zinc-400">
            <span className="material-symbols-outlined text-[13px] text-amber-400">cable</span>
            <span>13 CF Bindings Ready</span>
          </div>
        </div>

        <div className="statusbar-center hidden lg:flex text-zinc-500 text-[11px]">
          <span>Shortcuts: <kbd className="px-1 py-0.5 bg-zinc-800 rounded text-zinc-300 font-mono text-[10px]">Ctrl+,</kbd> Settings · <kbd className="px-1 py-0.5 bg-zinc-800 rounded text-zinc-300 font-mono text-[10px]">Ctrl+T</kbd> New Tab</span>
        </div>

        <div className="statusbar-right">
          <button
            type="button"
            className="statusbar-theme-btn"
            onClick={() => setIsSettingsOpen(true)}
            title="Open Theme Studio"
          >
            <span className="theme-swatch-dot small" style={{ background: currentThemeObj.previewColors.accent }} />
            <span>{currentThemeObj.name}</span>
          </button>
          <span className="status-sep">•</span>
          <span className="status-pill-subtle">Online</span>
        </div>
      </footer>

      {/* Real-time Settings & Theme Modal */}
      <AppSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onResetSettings={handleResetSettings}
      />
    </div>
  );
};
