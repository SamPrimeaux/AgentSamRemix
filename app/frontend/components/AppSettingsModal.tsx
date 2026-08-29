import React, { useState } from 'react';
import {
  AppSettings,
  THEME_PALETTES,
  ACCENT_SWATCHES,
  DEFAULT_APP_SETTINGS,
  ThemePalette,
} from '../services/themeService';
import { BindingsRuntimeView } from './bindings/BindingsRuntimeView';

interface AppSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
  onResetSettings: () => void;
}

export const AppSettingsModal: React.FC<AppSettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onResetSettings,
}) => {
  const [activeTab, setActiveTab] = useState<'themes' | 'bindings' | 'custom' | 'ai' | 'audio' | 'shell'>('themes');
  const [themeFilter, setThemeFilter] = useState<'all' | 'dark' | 'neon' | 'light'>('all');

  if (!isOpen) return null;

  const handleSelectTheme = (palette: ThemePalette) => {
    onUpdateSettings({
      ...settings,
      themeId: palette.id,
      customAccent: null, // Reset custom accent to let theme default shine
    });
  };

  const handleSelectAccent = (hex: string) => {
    onUpdateSettings({
      ...settings,
      customAccent: hex,
    });
  };

  const filteredPalettes = THEME_PALETTES.filter(p => {
    if (themeFilter === 'all') return true;
    return p.category === themeFilter;
  });

  return (
    <div className="settings-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="settings-modal-container"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Top Bar */}
        <div className="settings-modal-header">
          <div className="settings-header-title-group">
            <div className="settings-header-icon-box">
              <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'var(--app-accent, #8ab4f8)' }}>
                tune
              </span>
            </div>
            <div>
              <h2 className="settings-modal-title">App Settings & Live Theme Engine</h2>
              <p className="settings-modal-subtitle">Customize application shell, real-time palettes, AI parameters & sandbox telemetry</p>
            </div>
          </div>
          <button
            type="button"
            className="settings-close-btn"
            onClick={onClose}
            aria-label="Close Settings"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
          </button>
        </div>

        {/* Modal Tabs Navigation */}
        <div className="settings-nav-tabs">
          <button
            type="button"
            className={`settings-nav-tab ${activeTab === 'themes' ? 'active' : ''}`}
            onClick={() => setActiveTab('themes')}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>palette</span>
            <span>Theme Palettes</span>
          </button>
          <button
            type="button"
            className={`settings-nav-tab ${activeTab === 'bindings' ? 'active' : ''}`}
            onClick={() => setActiveTab('bindings')}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#38bdf8' }}>cable</span>
            <span>Bindings & Runtime</span>
          </button>
          <button
            type="button"
            className={`settings-nav-tab ${activeTab === 'custom' ? 'active' : ''}`}
            onClick={() => setActiveTab('custom')}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>brush</span>
            <span>Style & Typography</span>
          </button>
          <button
            type="button"
            className={`settings-nav-tab ${activeTab === 'ai' ? 'active' : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>smart_toy</span>
            <span>AI Model & Engine</span>
          </button>
          <button
            type="button"
            className={`settings-nav-tab ${activeTab === 'audio' ? 'active' : ''}`}
            onClick={() => setActiveTab('audio')}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>volume_up</span>
            <span>Voice & Audio</span>
          </button>
          <button
            type="button"
            className={`settings-nav-tab ${activeTab === 'shell' ? 'active' : ''}`}
            onClick={() => setActiveTab('shell')}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>desktop_windows</span>
            <span>Window & Shell</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="settings-modal-body">
          {/* TAB: BINDINGS & RUNTIME */}
          {activeTab === 'bindings' && (
            <div className="settings-section" style={{ maxWidth: '100%' }}>
              <BindingsRuntimeView />
            </div>
          )}

          {/* TAB 1: THEME PALETTES */}
          {activeTab === 'themes' && (
            <div className="settings-section">
              <div className="settings-filter-bar">
                <div className="settings-filter-label">Filter Category:</div>
                <div className="settings-filter-chips">
                  {(['all', 'dark', 'neon', 'light'] as const).map(cat => (
                    <button
                      key={cat}
                      type="button"
                      className={`filter-chip ${themeFilter === cat ? 'active' : ''}`}
                      onClick={() => setThemeFilter(cat)}
                    >
                      {cat.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div className="theme-grid">
                {filteredPalettes.map(palette => {
                  const isSelected = settings.themeId === palette.id;
                  return (
                    <div
                      key={palette.id}
                      className={`theme-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleSelectTheme(palette)}
                    >
                      <div
                        className="theme-card-preview"
                        style={{ background: palette.previewColors.bg }}
                      >
                        <div
                          className="theme-card-preview-bar"
                          style={{ background: palette.previewColors.surface, borderColor: palette.previewColors.accent }}
                        >
                          <div
                            className="theme-preview-dot"
                            style={{ background: palette.previewColors.accent }}
                          />
                          <div
                            className="theme-preview-line"
                            style={{ background: palette.previewColors.text }}
                          />
                        </div>
                        <div className="theme-card-preview-pills">
                          <span
                            className="theme-preview-badge"
                            style={{
                              background: palette.previewColors.surface,
                              color: palette.previewColors.accent,
                              border: `1px solid ${palette.previewColors.accent}44`,
                            }}
                          >
                            Live UI
                          </span>
                          <span
                            className="theme-preview-color-blob"
                            style={{ background: palette.previewColors.accent }}
                          />
                        </div>
                      </div>

                      <div className="theme-card-info">
                        <div className="theme-card-header-row">
                          <div className="theme-card-name">{palette.name}</div>
                          {isSelected && (
                            <span className="theme-active-tag">ACTIVE</span>
                          )}
                        </div>
                        <p className="theme-card-desc">{palette.tagline}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Accent Color Customizer */}
              <div className="settings-sub-card" style={{ marginTop: '20px' }}>
                <div className="sub-card-header">
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--app-accent)' }}>
                    colorize
                  </span>
                  <span className="sub-card-title">Live Accent Color Override</span>
                </div>
                <p className="sub-card-desc">Override the primary theme accent color dynamically across buttons, focus rings, and glowing badges.</p>

                <div className="accent-swatch-list">
                  {ACCENT_SWATCHES.map(swatch => {
                    const isCurrent = settings.customAccent === swatch.hex;
                    return (
                      <button
                        key={swatch.hex}
                        type="button"
                        className={`accent-swatch-btn ${isCurrent ? 'active' : ''}`}
                        onClick={() => handleSelectAccent(swatch.hex)}
                        title={swatch.name}
                      >
                        <span className="swatch-circle" style={{ background: swatch.hex }} />
                        <span className="swatch-name">{swatch.name}</span>
                      </button>
                    );
                  })}
                  {settings.customAccent && (
                    <button
                      type="button"
                      className="accent-reset-btn"
                      onClick={() => onUpdateSettings({ ...settings, customAccent: null })}
                    >
                      Reset to Theme Default
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: STYLE & TYPOGRAPHY */}
          {activeTab === 'custom' && (
            <div className="settings-section">
              <div className="settings-grid-cols">
                {/* UI Density */}
                <div className="settings-sub-card">
                  <div className="sub-card-header">
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--app-accent)' }}>
                      density_medium
                    </span>
                    <span className="sub-card-title">UI Density</span>
                  </div>
                  <p className="sub-card-desc">Adjust padding, button height, and overall density of the browser interface.</p>
                  <div className="settings-button-group">
                    {(['compact', 'comfortable', 'spacious'] as const).map(density => (
                      <button
                        key={density}
                        type="button"
                        className={`settings-opt-btn ${settings.uiDensity === density ? 'active' : ''}`}
                        onClick={() => onUpdateSettings({ ...settings, uiDensity: density })}
                      >
                        {density.charAt(0).toUpperCase() + density.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Border Radius */}
                <div className="settings-sub-card">
                  <div className="sub-card-header">
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--app-accent)' }}>
                      rounded_corner
                    </span>
                    <span className="sub-card-title">Border Corner Radius</span>
                  </div>
                  <p className="sub-card-desc">Choose between sharp geometric edges or curved modern surfaces.</p>
                  <div className="settings-button-group">
                    {(['sharp', 'medium', 'rounded'] as const).map(radius => (
                      <button
                        key={radius}
                        type="button"
                        className={`settings-opt-btn ${settings.borderRadius === radius ? 'active' : ''}`}
                        onClick={() => onUpdateSettings({ ...settings, borderRadius: radius })}
                      >
                        {radius === 'sharp' ? 'Sharp (4px)' : radius === 'medium' ? 'Modern (12px)' : 'Curved (20px)'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Typography Selection */}
                <div className="settings-sub-card">
                  <div className="sub-card-header">
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--app-accent)' }}>
                      format_size
                    </span>
                    <span className="sub-card-title">App Font Family</span>
                  </div>
                  <p className="sub-card-desc">Change the primary typeface utilized throughout the application shell.</p>
                  <div className="settings-button-group">
                    {(['google-sans', 'mono', 'system', 'inter'] as const).map(font => (
                      <button
                        key={font}
                        type="button"
                        className={`settings-opt-btn ${settings.fontFamily === font ? 'active' : ''}`}
                        onClick={() => onUpdateSettings({ ...settings, fontFamily: font })}
                      >
                        {font === 'google-sans' ? 'Google Sans' : font === 'mono' ? 'Developer Mono' : font === 'inter' ? 'Inter Clean' : 'System Native'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Background Pattern */}
                <div className="settings-sub-card">
                  <div className="sub-card-header">
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--app-accent)' }}>
                      texture
                    </span>
                    <span className="sub-card-title">Canvas Backdrop Style</span>
                  </div>
                  <p className="sub-card-desc">Visual texture for outer wallpaper surrounding the browser viewport.</p>
                  <div className="settings-button-group">
                    {(['minimal', 'dots', 'grid', 'vignette'] as const).map(pat => (
                      <button
                        key={pat}
                        type="button"
                        className={`settings-opt-btn ${settings.backgroundPattern === pat ? 'active' : ''}`}
                        onClick={() => onUpdateSettings({ ...settings, backgroundPattern: pat })}
                      >
                        {pat.charAt(0).toUpperCase() + pat.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Toggles */}
              <div className="settings-sub-card" style={{ marginTop: '16px' }}>
                <div className="settings-toggle-row">
                  <div>
                    <div className="toggle-label-title">Glassmorphism & Backdrop Blur</div>
                    <div className="toggle-label-desc">Enables translucent frosted glass layers on tab bars and menus</div>
                  </div>
                  <button
                    type="button"
                    className={`toggle-track ${settings.enableGlassmorphism ? 'active' : ''}`}
                    onClick={() => onUpdateSettings({ ...settings, enableGlassmorphism: !settings.enableGlassmorphism })}
                  >
                    <div className="toggle-thumb" />
                  </button>
                </div>

                <div className="settings-toggle-row" style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px solid var(--app-border)' }}>
                  <div>
                    <div className="toggle-label-title">Luminescent Accent Glow Effects</div>
                    <div className="toggle-label-desc">Render soft neon glows on active borders, active tabs, and telemetry meters</div>
                  </div>
                  <button
                    type="button"
                    className={`toggle-track ${settings.enableGlowEffects ? 'active' : ''}`}
                    onClick={() => onUpdateSettings({ ...settings, enableGlowEffects: !settings.enableGlowEffects })}
                  >
                    <div className="toggle-thumb" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: AI MODEL & ENGINE */}
          {activeTab === 'ai' && (
            <div className="settings-section">
              <div className="settings-sub-card">
                <div className="sub-card-header">
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--app-accent)' }}>
                    psychology
                  </span>
                  <span className="sub-card-title">Default Generative Model</span>
                </div>
                <p className="sub-card-desc">Select the primary model used for generating dynamic client web layouts and scripts.</p>

                <div className="model-selector-grid">
                  <div
                    className={`model-card ${settings.geminiModel === 'gemini-3.7-flash' ? 'active' : ''}`}
                    onClick={() => onUpdateSettings({ ...settings, geminiModel: 'gemini-3.7-flash' })}
                  >
                    <div className="model-header">
                      <span className="model-name">Gemini 3.7 Flash</span>
                      <span className="model-speed-badge">RECOMMENDED</span>
                    </div>
                    <p className="model-desc">Sub-second generation latency, rich HTML/CSS precision, fast interactive streaming.</p>
                  </div>

                  <div
                    className={`model-card ${settings.geminiModel === 'gemini-2.5-flash' ? 'active' : ''}`}
                    onClick={() => onUpdateSettings({ ...settings, geminiModel: 'gemini-2.5-flash' })}
                  >
                    <div className="model-header">
                      <span className="model-name">Gemini 2.5 Flash</span>
                      <span className="model-speed-badge" style={{ background: '#374151', color: '#9ca3af' }}>LEGACY</span>
                    </div>
                    <p className="model-desc">Standard generative fallback model with balanced execution capabilities.</p>
                  </div>
                </div>
              </div>

              <div className="settings-sub-card" style={{ marginTop: '16px' }}>
                <div className="settings-toggle-row">
                  <div>
                    <div className="toggle-label-title">Always Enable Google Search Grounding</div>
                    <div className="toggle-label-desc">Grounds web generation with live factual citations from Google Search</div>
                  </div>
                  <button
                    type="button"
                    className={`toggle-track ${settings.autoGrounding ? 'active' : ''}`}
                    onClick={() => onUpdateSettings({ ...settings, autoGrounding: !settings.autoGrounding })}
                  >
                    <div className="toggle-thumb" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: VOICE & AUDIO (TTS) */}
          {activeTab === 'audio' && (
            <div className="settings-section">
              <div className="settings-sub-card">
                <div className="sub-card-header">
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--app-accent)' }}>
                    record_voice_over
                  </span>
                  <span className="sub-card-title">Speech Synthesis (TTS) Preferences</span>
                </div>
                <p className="sub-card-desc">Control narration speed, pitch, and playback behavior when reading generated pages.</p>

                <div className="slider-group" style={{ marginTop: '16px' }}>
                  <div className="slider-label-row">
                    <span>Narration Speed (Rate)</span>
                    <span className="slider-val">{settings.ttsRate}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    value={settings.ttsRate}
                    onChange={e => onUpdateSettings({ ...settings, ttsRate: parseFloat(e.target.value) })}
                    className="settings-slider"
                  />
                </div>

                <div className="slider-group" style={{ marginTop: '16px' }}>
                  <div className="slider-label-row">
                    <span>Voice Pitch</span>
                    <span className="slider-val">{settings.ttsPitch}</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="1.5"
                    step="0.1"
                    value={settings.ttsPitch}
                    onChange={e => onUpdateSettings({ ...settings, ttsPitch: parseFloat(e.target.value) })}
                    className="settings-slider"
                  />
                </div>

                <div className="settings-toggle-row" style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid var(--app-border)' }}>
                  <div>
                    <div className="toggle-label-title">Auto-Read On Page Generation</div>
                    <div className="toggle-label-desc">Automatically begin voice narration once a web page finishes streaming</div>
                  </div>
                  <button
                    type="button"
                    className={`toggle-track ${settings.ttsAutoplay ? 'active' : ''}`}
                    onClick={() => onUpdateSettings({ ...settings, ttsAutoplay: !settings.ttsAutoplay })}
                  >
                    <div className="toggle-thumb" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: WINDOW & SHELL */}
          {activeTab === 'shell' && (
            <div className="settings-section">
              <div className="settings-sub-card">
                <div className="sub-card-header">
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--app-accent)' }}>
                    web_asset
                  </span>
                  <span className="sub-card-title">Application Shell & Window Controls</span>
                </div>
                <p className="sub-card-desc">Configure native OS window controls, status bar displays, and telemetry indicators.</p>

                <div className="settings-toggle-row" style={{ marginTop: '16px' }}>
                  <div>
                    <div className="toggle-label-title">Show Native Window Control Dots</div>
                    <div className="toggle-label-desc">Displays red/yellow/green window controls in the top navigation frame</div>
                  </div>
                  <button
                    type="button"
                    className={`toggle-track ${settings.showWindowControls ? 'active' : ''}`}
                    onClick={() => onUpdateSettings({ ...settings, showWindowControls: !settings.showWindowControls })}
                  >
                    <div className="toggle-thumb" />
                  </button>
                </div>

                <div className="settings-toggle-row" style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--app-border)' }}>
                  <div>
                    <div className="toggle-label-title">Live Token Counters in Header</div>
                    <div className="toggle-label-desc">Show real-time streaming input/output token telemetry on every page load</div>
                  </div>
                  <button
                    type="button"
                    className={`toggle-track ${settings.showLiveTokens ? 'active' : ''}`}
                    onClick={() => onUpdateSettings({ ...settings, showLiveTokens: !settings.showLiveTokens })}
                  >
                    <div className="toggle-thumb" />
                  </button>
                </div>
              </div>

              {/* Reset to Default */}
              <div className="settings-sub-card" style={{ marginTop: '16px' }}>
                <div className="sub-card-header">
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--app-error)' }}>
                    restart_alt
                  </span>
                  <span className="sub-card-title" style={{ color: 'var(--app-error)' }}>Factory Reset</span>
                </div>
                <p className="sub-card-desc">Reset all theme choices, custom styles, and AI preferences to original application defaults.</p>
                <button
                  type="button"
                  className="reset-all-btn"
                  onClick={onResetSettings}
                >
                  Reset Settings to Default
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="settings-modal-footer">
          <div className="settings-footer-info">
            <span>Theme: <strong>{THEME_PALETTES.find(t => t.id === settings.themeId)?.name}</strong></span>
            <span style={{ margin: '0 8px', opacity: 0.4 }}>•</span>
            <span>Live Sync Active</span>
          </div>
          <button
            type="button"
            className="settings-done-btn"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
