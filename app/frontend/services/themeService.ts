export interface ThemePalette {
  id: string;
  name: string;
  tagline: string;
  category: 'dark' | 'light' | 'neon';
  previewColors: {
    bg: string;
    surface: string;
    accent: string;
    text: string;
  };
  variables: Record<string, string>;
}

export interface AppSettings {
  themeId: string;
  customAccent: string | null;
  uiDensity: 'compact' | 'comfortable' | 'spacious';
  borderRadius: 'sharp' | 'medium' | 'rounded';
  enableGlassmorphism: boolean;
  enableGlowEffects: boolean;
  backgroundPattern: 'minimal' | 'dots' | 'grid' | 'vignette';
  fontFamily: 'google-sans' | 'mono' | 'system' | 'inter';
  geminiModel: string;
  autoGrounding: boolean;
  temperature: number;
  ttsRate: number;
  ttsPitch: number;
  ttsAutoplay: boolean;
  showWindowControls: boolean;
  showFpsTelemetry: boolean;
  showLiveTokens: boolean;
}

function palette(
  id: string,
  name: string,
  tagline: string,
  category: ThemePalette['category'],
  bg: string,
  surface: string,
  accent: string,
  text: string,
): ThemePalette {
  return {
    id,
    name,
    tagline,
    category,
    previewColors: { bg, surface, accent, text },
    variables: {
      '--app-bg': bg,
      '--app-canvas-bg': bg,
      '--app-surface-1': surface,
      '--app-surface-2': surface,
      '--app-surface-3': surface,
      '--app-border': `${accent}33`,
      '--app-border-hover': `${accent}66`,
      '--app-border-focus': accent,
      '--app-text-primary': text,
      '--app-text-secondary': text,
      '--app-text-muted': `${text}99`,
      '--app-accent': accent,
      '--app-accent-glow': `${accent}55`,
      '--app-accent-hover': accent,
      '--app-success': '#34d399',
      '--app-warning': '#fbbf24',
      '--app-error': '#f87171',
      '--app-tab-bg': surface,
      '--app-tab-active': surface,
      '--app-omnibar-bg': surface,
      '--app-omnibar-focus': surface,
      '--app-shadow': `0 8px 32px ${accent}22`,
    },
  };
}

export const THEME_PALETTES: ThemePalette[] = [
  palette(
    'midnight-titanium',
    'Midnight Titanium',
    'Refined dark slate with deep titanium finishes and sapphire accents',
    'dark',
    '#0c0d10',
    '#181a20',
    '#8ab4f8',
    '#e8eaed',
  ),
  palette(
    'cyber-obsidian',
    'Cyber Obsidian',
    'OLED pitch black with electric cyan & emerald terminal glow',
    'neon',
    '#000000',
    '#0d1117',
    '#00f2fe',
    '#f0f6fc',
  ),
  palette(
    'deepmind-sapphire',
    'DeepMind Sapphire',
    'Google AI Studio cobalt blue atmosphere with crisp luminescent accents',
    'dark',
    '#080d1a',
    '#0f172a',
    '#38bdf8',
    '#f8fafc',
  ),
  palette(
    'solar-amber',
    'Solar Amber',
    'Warm golden hues and cozy dusk slate, easy on the eyes',
    'dark',
    '#121110',
    '#1d1917',
    '#f59e0b',
    '#fef3c7',
  ),
  palette(
    'matrix-terminal',
    'Matrix Phosphor',
    'Authentic cyberpunk terminal aesthetics with phosphor emerald glow',
    'neon',
    '#050a06',
    '#0a160d',
    '#10b981',
    '#d1fae5',
  ),
  palette(
    'sunset-velvet',
    'Sunset Velvet',
    'Deep rich purple canvas with vibrant neon coral and rose accents',
    'dark',
    '#0f0814',
    '#1a0f24',
    '#f43f5e',
    '#ffe4e6',
  ),
  palette(
    'nordic-frost',
    'Nordic Frost',
    'Arctic charcoal with glacial cyan highlights and crisp clarity',
    'dark',
    '#0b1118',
    '#131e2b',
    '#38bdf8',
    '#e2e8f0',
  ),
  palette(
    'daybreak-studio',
    'Daybreak Studio',
    'Pristine architectural light theme with ultra-clean contrast',
    'light',
    '#f1f5f9',
    '#ffffff',
    '#2563eb',
    '#0f172a',
  ),
];

export const ACCENT_SWATCHES = [
  { name: 'Google Blue', hex: '#8ab4f8' },
  { name: 'Neon Cyan', hex: '#00f2fe' },
  { name: 'Matrix Emerald', hex: '#10b981' },
  { name: 'Solar Amber', hex: '#f59e0b' },
  { name: 'Neon Coral', hex: '#f43f5e' },
  { name: 'Violet Nebula', hex: '#a855f7' },
  { name: 'Pure White', hex: '#ffffff' },
];

export const DEFAULT_APP_SETTINGS: AppSettings = {
  themeId: 'midnight-titanium',
  customAccent: null,
  uiDensity: 'comfortable',
  borderRadius: 'medium',
  enableGlassmorphism: true,
  enableGlowEffects: true,
  backgroundPattern: 'vignette',
  fontFamily: 'google-sans',
  geminiModel: 'gemini-3.7-flash',
  autoGrounding: false,
  temperature: 0.7,
  ttsRate: 1,
  ttsPitch: 1,
  ttsAutoplay: false,
  showWindowControls: true,
  showFpsTelemetry: false,
  showLiveTokens: true,
};

const SETTINGS_STORAGE_KEY = 'agentsam_app_settings_v3';

export function loadStoredSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_APP_SETTINGS;
    return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) };
  } catch (error) {
    console.warn('Failed to load stored settings, using defaults:', error);
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveStoredSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('Failed to save settings to localStorage:', error);
  }
}

export function applyThemeToDocument(settings: AppSettings): void {
  const root = document.documentElement;
  const selected = THEME_PALETTES.find(theme => theme.id === settings.themeId) ?? THEME_PALETTES[0];

  for (const [key, value] of Object.entries(selected.variables)) {
    root.style.setProperty(key, value);
  }

  if (settings.customAccent) {
    root.style.setProperty('--app-accent', settings.customAccent);
    root.style.setProperty('--app-border-focus', settings.customAccent);
    root.style.setProperty('--app-accent-glow', `${settings.customAccent}55`);
  }

  const radii = {
    sharp: { base: '4px', card: '6px', pill: '8px' },
    medium: { base: '10px', card: '16px', pill: '24px' },
    rounded: { base: '16px', card: '24px', pill: '999px' },
  }[settings.borderRadius];
  root.style.setProperty('--app-radius-base', radii.base);
  root.style.setProperty('--app-radius-card', radii.card);
  root.style.setProperty('--app-radius-pill', radii.pill);

  root.style.setProperty(
    '--app-density-scale',
    { compact: '0.85', comfortable: '1', spacious: '1.15' }[settings.uiDensity],
  );

  root.style.setProperty(
    '--app-font-family',
    {
      'google-sans': "'Google Sans Flex', 'Google Sans', -apple-system, BlinkMacSystemFont, sans-serif",
      mono: "'Google Sans Mono', 'JetBrains Mono', monospace",
      system: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      inter: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    }[settings.fontFamily],
  );

  root.style.setProperty('--app-glow-opacity', settings.enableGlowEffects ? '1' : '0');
  root.style.setProperty('--app-glass-filter', settings.enableGlassmorphism ? 'blur(16px)' : 'none');
  document.body.style.background = selected.variables['--app-bg'] ?? '#000000';
  document.body.style.color = selected.variables['--app-text-primary'] ?? '#ffffff';
}
